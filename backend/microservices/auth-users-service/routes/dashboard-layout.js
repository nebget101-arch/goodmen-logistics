'use strict';

/**
 * FN-1172 (parent FN-1130) — Control Center layout persistence endpoints.
 *
 * Exposes:
 *   GET  /api/users/me/dashboard-layout
 *   PUT  /api/users/me/dashboard-layout
 *   DELETE /api/users/me/dashboard-layout  (reset-to-default convenience)
 *
 * Mounted with `authMiddleware` + `tenantContextMiddleware`, so
 * `req.user.id`, `req.user.role`, and `req.context.tenantId` are guaranteed.
 */

const express = require('express');
const knex = require('@goodmen/shared/config/knex');
const { createLayoutStore } = require('../services/layout-store');

const MAX_LAYOUT_BYTES = 16 * 1024;

function createDashboardLayoutRouter({ store } = {}) {
  const router = express.Router();
  const layoutStore = store || createLayoutStore({ knex });

  /**
   * @openapi
   * /api/users/me/dashboard-layout:
   *   get:
   *     summary: Get the authenticated user's Control Center layout
   *     description: Returns the persisted layout, or the role default when no row exists.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Layout JSON plus metadata
   *       401:
   *         description: Missing or invalid token
   */
  router.get('/', async (req, res) => {
    try {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      const role = req.user && req.user.role;
      const result = await layoutStore.getLayout({ userId, role });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[dashboard-layout] GET failed', err);
      return res.status(500).json({ error: 'Failed to load dashboard layout' });
    }
  });

  /**
   * @openapi
   * /api/users/me/dashboard-layout:
   *   put:
   *     summary: Persist the authenticated user's Control Center layout
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: Saved layout JSON plus metadata
   *       400:
   *         description: Invalid body or payload too large
   *       401:
   *         description: Missing or invalid token
   *       403:
   *         description: Tenant context unavailable
   */
  router.put('/', async (req, res) => {
    try {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

      const tenantId = req.context && req.context.tenantId;
      if (!tenantId) return res.status(403).json({ error: 'Tenant context required' });

      const layout = req.body;
      if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
        return res.status(400).json({ error: 'Request body must be a JSON object' });
      }

      const serialized = JSON.stringify(layout);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_LAYOUT_BYTES) {
        return res
          .status(400)
          .json({ error: `Layout payload exceeds ${MAX_LAYOUT_BYTES} bytes` });
      }

      const role = req.user && req.user.role;
      const result = await layoutStore.putLayout({ userId, tenantId, role, layout });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[dashboard-layout] PUT failed', err);
      return res.status(500).json({ error: 'Failed to update dashboard layout' });
    }
  });

  /**
   * @openapi
   * /api/users/me/dashboard-layout:
   *   delete:
   *     summary: Reset to role default (removes any persisted row)
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Role default layout returned
   *       401:
   *         description: Missing or invalid token
   */
  router.delete('/', async (req, res) => {
    try {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
      await layoutStore.deleteLayout({ userId });
      const role = req.user && req.user.role;
      const result = await layoutStore.getLayout({ userId, role });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[dashboard-layout] DELETE failed', err);
      return res.status(500).json({ error: 'Failed to reset dashboard layout' });
    }
  });

  return router;
}

module.exports = createDashboardLayoutRouter;
module.exports.createDashboardLayoutRouter = createDashboardLayoutRouter;
module.exports.MAX_LAYOUT_BYTES = MAX_LAYOUT_BYTES;
