const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const userDb = require('../internal/user');
const bcrypt = require('bcrypt');
const authMiddleware = require('../middleware/auth-middleware');
const knex = require('../internal/db').knex;
const rbacService = require('../services/rbac-service');
const tenantContextService = require('../services/tenant-context-service');
const { PLANS, normalizePlanId } = require('../config/plans');

// Secret for JWT (in production, use env var)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Authenticate user
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 example: demo
 *               password:
 *                 type: string
 *                 example: password123
 *             required:
 *               - username
 *               - password
 *     responses:
 *       200:
 *         description: User authenticated, JWT returned
 *       400:
 *         description: Missing credentials
 *       401:
 *         description: Invalid credentials
 */
// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const user = await userDb.getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign(
      { id: user.id, role: user.role, username: user.username, driver_id: user.driver_id || null },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      role: user.role,
      username: user.username,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
      email: user.email || null
    });
  } catch (err) {
    console.error('[auth/login]', err?.message || err);
    const payload = { error: 'Server error' };
    if (process.env.NODE_ENV !== 'production' && err?.message) {
      payload.detail = err.message;
    }
    res.status(500).json(payload);
  }
});

// GET /auth/me
// Unified session/access/context payload for frontend bootstrap.
router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (!knex) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const user = await knex('users')
      .where({ id: userId })
      .first('id', 'username', 'first_name', 'last_name', 'email', 'role', 'tenant_id');
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const [access, locationRows, entityRows, defaultContext] = await Promise.all([
      rbacService.loadUserAccess(userId),
      knex('user_locations as ul')
        .join('locations as l', 'l.id', 'ul.location_id')
        .where('ul.user_id', userId)
        .select('l.id', 'l.name'),
      tenantContextService.getUserOperatingEntities(knex, userId),
      tenantContextService.getDefaultContextForUser(knex, userId)
    ]);

    const roles = (access?.roles || []).map((r) => r.code);
    const permissions = Array.from(access?.permissions || []);
    const locations = (locationRows || []).map((l) => ({ id: l.id, name: l.name }));

    const sessionTenantId = user.tenant_id || defaultContext?.tenant?.tenant_id || defaultContext?.tenant?.id || null;
    let entities = (entityRows || []).map((entity) => ({
      id: entity.operating_entity_id,
      name: entity.operating_entity_name,
      mcNumber: entity.mc_number,
      dotNumber: entity.dot_number,
      isDefault: !!entity.is_default
    }));

    const isGlobalAdmin = roles.includes('super_admin') || (user.role || '').toString().trim().toLowerCase() === 'admin';
    if (isGlobalAdmin && sessionTenantId) {
      const tenantEntities = await knex('operating_entities')
        .where({ tenant_id: sessionTenantId, is_active: true })
        .orderBy('name', 'asc')
        .select('id', 'name', 'mc_number', 'dot_number');

      if (tenantEntities.length > 0) {
        const assignedDefaultId = entities.find((entity) => entity.isDefault)?.id || null;
        entities = tenantEntities.map((entity, index) => ({
          id: entity.id,
          name: entity.name,
          mcNumber: entity.mc_number,
          dotNumber: entity.dot_number,
          isDefault: assignedDefaultId ? entity.id === assignedDefaultId : index === 0
        }));
      }
    }

    const selectedOperatingEntityId =
      entities.find((entity) => entity.isDefault)?.id
      || entities[0]?.id
      || defaultContext?.operatingEntity?.id
      || null;

    let subscriptionPlanId = 'basic';
    if (sessionTenantId) {
      const tenantRecord = await knex('tenants')
        .where({ id: sessionTenantId })
        .first('id', 'subscription_plan');
      subscriptionPlanId = normalizePlanId(tenantRecord?.subscription_plan, 'basic');
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          firstName: user.first_name || null,
          lastName: user.last_name || null,
          email: user.email || null,
          role: user.role || null
        },
        roles,
        permissions,
        locations,
        tenantId: sessionTenantId,
        subscriptionPlanId,
        subscriptionPlan: PLANS[normalizePlanId(subscriptionPlanId, 'basic')] || null,
        accessibleOperatingEntities: entities,
        selectedOperatingEntityId
      }
    });
  } catch (err) {
    console.error('[auth/me]', err?.message || err);
    res.status(500).json({ success: false, error: 'Failed to load session context' });
  }
});

module.exports = router;
