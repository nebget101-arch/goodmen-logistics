'use strict';

/**
 * Tenant-facing inbound-email routes — FN-760
 *
 * Mounted at /api/tenants/me/inbound-email behind authMiddleware +
 * tenantContextMiddleware.
 *
 *   GET  /            -> current tenant's inbound address + basic settings
 *   GET  /logs        -> recent inbound emails for the tenant (paged)
 *
 * The POST /whitelist endpoint is owned by FN-761 (security layer) and is
 * intentionally not implemented here.
 */

const express = require('express');
const knex = require('../config/knex');

const router = express.Router();

const MAX_LIMIT = 100;

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
        inboundEmailAddress: null,
        configured: false,
        message: 'Inbound email feature not yet provisioned (FN-759 migration pending)'
      }
    });
  }

  const row = await knex('tenants')
    .where({ id: tenantId })
    .select('id', 'inbound_email_address')
    .first()
    .catch(() => null);

  return res.json({
    success: true,
    data: {
      tenantId,
      inboundEmailAddress: row?.inbound_email_address || null,
      configured: !!row?.inbound_email_address
    }
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

module.exports = router;
