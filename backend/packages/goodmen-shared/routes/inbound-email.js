'use strict';

/**
 * Tenant-facing inbound-email routes — FN-760 + FN-761
 *
 * Mounted at /api/tenants/me/inbound-email behind authMiddleware +
 * tenantContextMiddleware.
 *
 *   GET    /                  -> current tenant's inbound address + basic settings
 *   POST   /test              -> send a test email to the tenant's inbound address
 *   GET    /logs              -> recent inbound emails for the tenant (paged)
 *   GET    /whitelist         -> tenant's sender whitelist (FN-761)
 *   POST   /whitelist         -> add a sender or domain to the whitelist
 *   DELETE /whitelist/:id     -> remove an entry from the whitelist
 */

const express = require('express');
const knex = require('../config/knex');
const { sendEmail } = require('../services/notification-service');

const router = express.Router();

const MAX_LIMIT = 100;

function normalizeWhitelistPattern(raw) {
  const trimmed = (raw || '').toString().trim().toLowerCase();
  if (!trimmed) return null;
  const isDomain = trimmed.startsWith('@');
  if (!trimmed.includes('@')) return null;
  return { pattern: trimmed, isDomain };
}

router.get('/', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant context required' });
  }

  const hasColumn = await knex.schema
    .hasColumn('tenants', 'inbound_email_address')
    .catch(() => false);
  if (!hasColumn) {
    return res.json({
      success: true,
      data: {
        tenantId,
        address: null,
        is_active: false,
        message: 'Inbound email feature not yet provisioned (FN-759 migration pending)'
      }
    });
  }

  const row = await knex('tenants')
    .where({ id: tenantId })
    .select('id', 'inbound_email_address')
    .first()
    .catch(() => null);

  const address = row?.inbound_email_address || null;
  return res.json({
    success: true,
    data: {
      tenantId,
      address,
      is_active: !!address
    }
  });
});

router.post('/test', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ success: false, error: 'Forbidden: tenant context required' });
  }

  const hasColumn = await knex.schema
    .hasColumn('tenants', 'inbound_email_address')
    .catch(() => false);
  if (!hasColumn) {
    return res.status(503).json({
      success: false,
      error: 'Inbound email feature not yet provisioned'
    });
  }

  const row = await knex('tenants')
    .where({ id: tenantId })
    .select('inbound_email_address', 'name')
    .first()
    .catch(() => null);
  const address = row?.inbound_email_address;
  if (!address) {
    return res.status(400).json({
      success: false,
      error: 'No inbound email address configured for this tenant'
    });
  }

  const userEmail = (req.user?.email || '').trim() || null;
  const subject = 'FleetNeuron inbound email — pipeline test';
  const text = [
    'This is an automated test email sent from your FleetNeuron admin UI.',
    '',
    `It was delivered to ${address} via SendGrid Inbound Parse.`,
    'If the pipeline is healthy, within ~15 seconds this email should appear',
    'in the "Recent emails" table on /admin/inbound-email with status = succeeded',
    '(or failed + an error message if extraction rejected it).',
    '',
    userEmail ? `Triggered by: ${userEmail}` : 'Triggered by: (unknown user)',
    `Tenant: ${row?.name || tenantId}`
  ].join('\n');

  const result = await sendEmail({
    to: address,
    subject,
    text,
    replyTo: userEmail || undefined
  });

  if (!result.sent) {
    return res.status(502).json({
      success: false,
      error: result.error || 'Failed to send test email'
    });
  }

  return res.json({
    success: true,
    message: `Test email sent to ${address}. It should appear in the log within ~15 seconds.`
  });
});

router.get('/logs', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant context required' });
  }

  const hasTable = await knex.schema.hasTable('inbound_emails').catch(() => false);
  if (!hasTable) {
    return res.json({ success: true, data: [], total: 0, configured: false });
  }

  const limitRaw = parseInt(req.query.limit, 10);
  const offsetRaw = parseInt(req.query.offset, 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 25;
  const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  const baseQuery = knex('inbound_emails').where({ tenant_id: tenantId });
  const [{ count }] = await baseQuery.clone().count('id as count');
  const rows = await baseQuery
    .clone()
    .orderBy('received_at', 'desc')
    .limit(limit)
    .offset(offset)
    .select(
      'id',
      'from_email',
      'subject',
      'received_at',
      'load_id',
      'processing_status',
      'error_message'
    );

  return res.json({
    success: true,
    data: rows,
    total: Number(count) || 0,
    configured: true
  });
});

// ---------------------------------------------------------------------------
// Whitelist CRUD — FN-761
// ---------------------------------------------------------------------------

router.get('/whitelist', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant context required' });
  }
  const hasTable = await knex.schema
    .hasTable('inbound_email_whitelist')
    .catch(() => false);
  if (!hasTable) {
    return res.json({ success: true, data: [], configured: false });
  }
  const rows = await knex('inbound_email_whitelist')
    .where('tenant_id', tenantId)
    .orderBy('created_at', 'asc')
    .select('id', 'pattern', 'is_domain', 'created_by_user_id', 'created_at');
  return res.json({ success: true, data: rows, configured: true });
});

router.post('/whitelist', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant context required' });
  }
  const hasTable = await knex.schema
    .hasTable('inbound_email_whitelist')
    .catch(() => false);
  if (!hasTable) {
    return res
      .status(503)
      .json({ success: false, error: 'Whitelist table not provisioned' });
  }

  const parsed = normalizeWhitelistPattern(req.body?.pattern);
  if (!parsed) {
    return res.status(400).json({
      success: false,
      error: 'Pattern must be a valid email address or `@domain.com`'
    });
  }

  try {
    const [row] = await knex('inbound_email_whitelist')
      .insert({
        tenant_id: tenantId,
        pattern: parsed.pattern,
        is_domain: parsed.isDomain,
        created_by_user_id: req.user?.id || null
      })
      .returning(['id', 'pattern', 'is_domain', 'created_by_user_id', 'created_at']);
    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    // Postgres unique-violation code
    if (err?.code === '23505') {
      return res
        .status(409)
        .json({ success: false, error: 'Pattern already exists for this tenant' });
    }
    return res
      .status(500)
      .json({ success: false, error: 'Failed to add whitelist entry' });
  }
});

router.delete('/whitelist/:id', async (req, res) => {
  const tenantId = req.context?.tenantId || req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ error: 'Forbidden: tenant context required' });
  }
  const hasTable = await knex.schema
    .hasTable('inbound_email_whitelist')
    .catch(() => false);
  if (!hasTable) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  const deleted = await knex('inbound_email_whitelist')
    .where({ tenant_id: tenantId, id: req.params.id })
    .del();
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Whitelist entry not found' });
  }
  return res.json({ success: true });
});

module.exports = router;
