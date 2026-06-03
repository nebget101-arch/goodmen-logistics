'use strict';

/**
 * FN-1675 (Story E — Share-link generation + management) — Share-link API.
 *
 * Brokers mint per-load public tracking links, list them with view counts, and
 * revoke them. Token-only auth (no PIN/email gate — intake decision): the raw
 * 32-byte base64url token is returned exactly once on create and only its
 * SHA-256 hash is stored.
 *
 *   POST   /api/loads/:id/share-links   create a link for a load
 *   GET    /api/loads/:id/share-links   list a load's links (+ view stats)
 *   DELETE /api/share-links/:id         revoke a link (sets revoked_at)
 *
 * Mounted at `/api` so it can own both the load-scoped and the bare
 * `/share-links/:id` paths. The host service applies auth + tenant-context
 * middleware before this router; we additionally restrict to admin/dispatch.
 *
 * The public read endpoint that consumes these tokens lives in Story F
 * (FN-1658); this router never exposes a token hash to clients.
 */

const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');
const auth = require('./auth-middleware');
const shareLinkService = require('../services/share-link-service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public-page base for the share URL returned on create.
const SHARE_BASE_URL = (
  process.env.PUBLIC_APP_URL ||
  process.env.FRONTEND_BASE_URL ||
  'https://fleetneuron.ai'
).replace(/\/$/, '');

router.use(auth(['admin', 'dispatch']));

function getTenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

function getOperatingEntityId(req) {
  return req.context?.operatingEntityId || null;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function buildShareUrl(rawToken) {
  return `${SHARE_BASE_URL}/track/${rawToken}`;
}

/** Derive a coarse lifecycle status for the broker-facing list. */
function deriveStatus(row, now = Date.now()) {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'active';
}

/** Shape a row for client responses — never leaks token_hash. */
function serialize(row) {
  return {
    id: row.id,
    load_id: row.load_id,
    created_by: row.created_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    view_count: row.view_count,
    last_viewed_at: row.last_viewed_at,
    reveal_options: row.reveal_options || {},
    status: deriveStatus(row)
  };
}

/** Fetch a load scoped to the caller's tenant (and operating entity if set). */
async function getLoadForTenant(loadId, tenantId, operatingEntityId) {
  const params = [loadId, tenantId];
  let sql =
    'SELECT id, delivery_date FROM loads WHERE id = $1 AND tenant_id = $2';
  if (operatingEntityId) {
    params.push(operatingEntityId);
    sql += ` AND operating_entity_id = $${params.length}`;
  }
  const result = await query(sql, params);
  return result.rows[0] || null;
}

/**
 * POST /api/loads/:id/share-links — create a share link.
 * Body (all optional): { expiresAt?: ISO string, revealOptions?: {...} }
 */
router.post('/loads/:id/share-links', async (req, res) => {
  const loadId = req.params.id;
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant context required' });
  if (!isUuid(loadId)) return res.status(404).json({ error: 'Load not found' });

  try {
    const load = await getLoadForTenant(loadId, tenantId, getOperatingEntityId(req));
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const expiresAt = shareLinkService.resolveExpiry({
      expiresAt: req.body?.expiresAt,
      deliveryDate: load.delivery_date
    });
    if (expiresAt === null) {
      return res.status(400).json({ error: 'Invalid expiresAt' });
    }

    const revealOptions = shareLinkService.normalizeRevealOptions(
      req.body?.revealOptions
    );
    const rawToken = shareLinkService.generateToken();
    const tokenHash = shareLinkService.hashToken(rawToken);
    const createdBy = req.user?.id || null;

    const insert = await query(
      `INSERT INTO load_share_links
         (load_id, token_hash, created_by, expires_at, reveal_options)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, load_id, created_by, created_at, expires_at, revoked_at,
                 view_count, last_viewed_at, reveal_options`,
      [loadId, tokenHash, createdBy, expiresAt, JSON.stringify(revealOptions)]
    );

    const row = insert.rows[0];
    // Raw token is returned ONCE here and never again.
    return res.status(201).json({
      ...serialize(row),
      token: rawToken,
      url: buildShareUrl(rawToken)
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to create share link', detail: err.message });
  }
});

/** GET /api/loads/:id/share-links — list a load's share links. */
router.get('/loads/:id/share-links', async (req, res) => {
  const loadId = req.params.id;
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant context required' });
  if (!isUuid(loadId)) return res.status(404).json({ error: 'Load not found' });

  try {
    const load = await getLoadForTenant(loadId, tenantId, getOperatingEntityId(req));
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const result = await query(
      `SELECT id, load_id, created_by, created_at, expires_at, revoked_at,
              view_count, last_viewed_at, reveal_options
         FROM load_share_links
        WHERE load_id = $1
        ORDER BY created_at DESC`,
      [loadId]
    );

    return res.json({ data: result.rows.map(serialize) });
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to list share links', detail: err.message });
  }
});

/** DELETE /api/share-links/:id — revoke a share link. */
router.delete('/share-links/:id', async (req, res) => {
  const shareLinkId = req.params.id;
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(403).json({ error: 'Tenant context required' });
  if (!isUuid(shareLinkId)) {
    return res.status(404).json({ error: 'Share link not found' });
  }

  try {
    const operatingEntityId = getOperatingEntityId(req);
    // Join to loads so revocation is scoped to the caller's tenant/entity.
    const params = [shareLinkId, tenantId];
    let sql = `
      SELECT sl.id, sl.load_id, sl.created_by, sl.created_at, sl.expires_at,
             sl.revoked_at, sl.view_count, sl.last_viewed_at, sl.reveal_options
        FROM load_share_links sl
        JOIN loads l ON l.id = sl.load_id
       WHERE sl.id = $1 AND l.tenant_id = $2`;
    if (operatingEntityId) {
      params.push(operatingEntityId);
      sql += ` AND l.operating_entity_id = $${params.length}`;
    }
    const existing = await query(sql, params);
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Share link not found' });

    if (row.revoked_at) {
      // Idempotent: already revoked.
      return res.json(serialize(row));
    }

    const updated = await query(
      `UPDATE load_share_links
          SET revoked_at = now()
        WHERE id = $1
        RETURNING id, load_id, created_by, created_at, expires_at, revoked_at,
                  view_count, last_viewed_at, reveal_options`,
      [shareLinkId]
    );

    return res.json(serialize(updated.rows[0]));
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'Failed to revoke share link', detail: err.message });
  }
});

module.exports = router;
