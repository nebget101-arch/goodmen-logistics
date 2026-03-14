'use strict';

const knex = require('../config/knex');
const { PLANS } = require('../config/plans');

const PLAN_CACHE_TTL_MS = 60 * 1000;
const tenantPlanCache = new Map();
let auditLogColumnsCache = null;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const noQuery = raw.split('?')[0].split('#')[0].trim();
  if (!noQuery) return '';
  const prefixed = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed;
}

function getRequiredPlanPath(requiredPathOrResolver, req) {
  if (typeof requiredPathOrResolver === 'function') {
    return normalizePath(requiredPathOrResolver(req));
  }
  return normalizePath(requiredPathOrResolver);
}

async function getTenantPlanId(knexClient, tenantId) {
  const now = Date.now();
  const cached = tenantPlanCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    return cached.planId;
  }

  const tenant = await knexClient('tenants')
    .where({ id: tenantId })
    .first('subscription_plan');

  const planId = tenant?.subscription_plan || 'end_to_end';
  tenantPlanCache.set(tenantId, { planId, expiresAt: now + PLAN_CACHE_TTL_MS });
  return planId;
}

async function getAuditLogColumns(knexClient) {
  if (auditLogColumnsCache) return auditLogColumnsCache;

  const rows = await knexClient('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: 'audit_logs' });

  auditLogColumnsCache = new Set((rows || []).map((r) => r.column_name));
  return auditLogColumnsCache;
}

function resolveRequestIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0] || '').split(',')[0].trim() || null;
  }
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

async function writePlanDeniedAudit(knexClient, req, {
  planId,
  requiredPath,
  denyStatusCode
}) {
  const columns = await getAuditLogColumns(knexClient);
  if (!columns || columns.size === 0) return;

  const tenantId = req.context?.tenantId || req.user?.tenant_id || null;
  const operatingEntityId = req.context?.operatingEntityId || null;
  const userId = req.user?.id || req.user?.sub || null;

  const fallbackEntityId = looksLikeUuid(tenantId)
    ? tenantId
    : (looksLikeUuid(userId) ? userId : NIL_UUID);

  const payload = {
    entity_type: 'plan_access',
    entity_id: fallbackEntityId,
    action: 'PLAN_ACCESS_DENIED',
    changes: {
      code: 'PLAN_ACCESS_DENIED',
      subscriptionPlanId: planId,
      requiredFeaturePath: requiredPath,
      method: req.method,
      originalUrl: req.originalUrl,
      path: req.path,
      userAgent: req.headers?.['user-agent'] || null,
      deniedStatus: denyStatusCode,
      deniedAt: new Date().toISOString(),
      tenantId,
      operatingEntityId,
      userId
    },
    performed_by: userId ? String(userId) : 'anonymous',
    ip_address: resolveRequestIp(req)
  };

  if (columns.has('tenant_id') && looksLikeUuid(tenantId)) {
    payload.tenant_id = tenantId;
  }
  if (columns.has('operating_entity_id') && looksLikeUuid(operatingEntityId)) {
    payload.operating_entity_id = operatingEntityId;
  }

  await knexClient('audit_logs').insert(payload);
}

function isPlanPathAllowed(planId, requiredPath) {
  const plan = PLANS[planId] || PLANS.end_to_end;
  const allowedPages = Array.isArray(plan?.includedPages) ? plan.includedPages : [];
  const normalizedRequiredPath = normalizePath(requiredPath);
  if (!normalizedRequiredPath) return true;
  if (!allowedPages.length) return true;

  return allowedPages.some((candidate) => {
    const normalizedCandidate = normalizePath(candidate);
    return (
      normalizedRequiredPath === normalizedCandidate
      || normalizedRequiredPath.startsWith(`${normalizedCandidate}/`)
    );
  });
}

function createPlanAccessMiddleware(requiredPathOrResolver, options = {}) {
  const {
    knexClient = knex,
    fallbackPlanId = 'end_to_end',
    denyStatusCode = 403,
    allowWhenTenantMissing = true
  } = options;

  return async function planAccessMiddleware(req, res, next) {
    try {
      const requiredPath = getRequiredPlanPath(requiredPathOrResolver, req);
      if (!requiredPath) return next();

      const tenantId = req.context?.tenantId || req.user?.tenant_id || null;
      if (!tenantId) {
        if (allowWhenTenantMissing) return next();
        return res.status(denyStatusCode).json({
          success: false,
          error: 'Forbidden: tenant context missing for plan validation',
          code: 'PLAN_ACCESS_TENANT_MISSING'
        });
      }

      const planId = await getTenantPlanId(knexClient, tenantId).catch(() => fallbackPlanId);
      if (isPlanPathAllowed(planId, requiredPath)) {
        return next();
      }

      await writePlanDeniedAudit(knexClient, req, {
        planId,
        requiredPath,
        denyStatusCode
      }).catch((auditErr) => {
        console.warn('[plan-access-middleware] failed to write audit log', auditErr?.message || auditErr);
      });

      res.setHeader('X-Debug-Plan-Id', planId);
      res.setHeader('X-Debug-Required-Plan-Path', requiredPath);

      return res.status(denyStatusCode).json({
        success: false,
        error: 'Forbidden: your subscription plan does not include this feature',
        code: 'PLAN_ACCESS_DENIED',
        subscriptionPlanId: planId,
        requiredFeaturePath: requiredPath
      });
    } catch (err) {
      console.error('[plan-access-middleware]', err?.message || err);
      return res.status(500).json({
        success: false,
        error: 'Failed to validate plan access',
        code: 'PLAN_ACCESS_CHECK_FAILED'
      });
    }
  };
}

module.exports = createPlanAccessMiddleware;
module.exports.createPlanAccessMiddleware = createPlanAccessMiddleware;
