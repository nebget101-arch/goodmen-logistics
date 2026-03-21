const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const router = express.Router();
const userDb = require('../internal/user');
const bcrypt = require('bcrypt');
const authMiddleware = require('../middleware/auth-middleware');
const knex = require('../internal/db').knex;
const { sendEmail } = require('../services/notification-service');
const rbacService = require('../services/rbac-service');
const tenantContextService = require('../services/tenant-context-service');
const { PLANS, normalizePlanId } = require('../config/plans');

// Secret for JWT (in production, use env var)
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);
const RESET_LINK_BASE_URL =
  process.env.PASSWORD_RESET_URL_BASE
  || process.env.FRONTEND_URL
  || 'http://localhost:4200/reset-password';

function buildResetLink(token) {
  const separator = RESET_LINK_BASE_URL.includes('?') ? '&' : '?';
  return `${RESET_LINK_BASE_URL}${separator}token=${encodeURIComponent(token)}`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

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
    if (Object.prototype.hasOwnProperty.call(user, 'is_active') && user.is_active === false) {
      return res.status(403).json({ error: 'User account is inactive. Contact your administrator.' });
    }
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

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset link
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Generic confirmation response (always)
 */
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.'
  };

  if (!email) {
    return res.status(200).json(genericResponse);
  }

  try {
    if (!knex) {
      return res.status(200).json(genericResponse);
    }

    const user = await knex('users')
      .whereRaw('LOWER(email) = ?', [email])
      .first('id', 'email', 'username', 'first_name');

    // Security: never disclose whether user exists.
    if (!user || !user.id) {
      return res.status(200).json(genericResponse);
    }

    // Optional cleanup of stale/used tokens for this user.
    await knex('password_reset_tokens')
      .where({ user_id: user.id })
      .where((qb) => {
        qb.whereNotNull('used_at').orWhere('expires_at', '<', knex.fn.now());
      })
      .del();

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await knex('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    const resetLink = buildResetLink(resetToken);
    const displayName = user.first_name || user.username || 'there';
    const emailPayload = {
      to: user.email,
      subject: 'Reset your FleetNeuron password',
      text:
        `Hi ${displayName},\n\n` +
        `We received a request to reset your FleetNeuron password.\n` +
        `Use the link below to set a new password (valid for ${RESET_TOKEN_TTL_MINUTES} minutes):\n\n` +
        `${resetLink}\n\n` +
        `If you didn’t request this, you can safely ignore this email.`,
      html:
        `<p>Hi ${displayName},</p>` +
        `<p>We received a request to reset your FleetNeuron password.</p>` +
        `<p><a href="${resetLink}">Reset Password</a> (valid for ${RESET_TOKEN_TTL_MINUTES} minutes)</p>` +
        `<p>If you didn’t request this, you can safely ignore this email.</p>`
    };

    const emailResult = await sendEmail(emailPayload);
    if (!emailResult?.sent) {
      console.error('[auth/forgot-password] email send failed:', emailResult?.error || 'unknown');
    }

    return res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[auth/forgot-password]', err?.message || err);
    // Security: same generic response even on internal errors.
    return res.status(200).json(genericResponse);
  }
});

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with one-time token
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid request or token
 */
router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    if (!knex) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const resetRecord = await knex('password_reset_tokens')
      .where({ token_hash: tokenHash })
      .first('id', 'user_id', 'expires_at', 'used_at');

    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (resetRecord.used_at) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (new Date(resetRecord.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const user = await knex('users').where({ id: resetRecord.user_id }).first('id');
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await knex.transaction(async (trx) => {
      await trx('users')
        .where({ id: resetRecord.user_id })
        .update({ password_hash: passwordHash });

      await trx('password_reset_tokens')
        .where({ id: resetRecord.id })
        .update({ used_at: trx.fn.now() });
    });

    return res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('[auth/reset-password]', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
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
    let tenantName = null;
    if (sessionTenantId) {
      const tenantRecord = await knex('tenants')
        .where({ id: sessionTenantId })
        .first('id', 'name', 'subscription_plan');
      subscriptionPlanId = normalizePlanId(tenantRecord?.subscription_plan, 'basic');
      tenantName = tenantRecord?.name || null;
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
        tenantName,
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
