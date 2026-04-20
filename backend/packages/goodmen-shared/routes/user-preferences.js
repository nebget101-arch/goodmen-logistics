const express = require('express');
const router = express.Router();
const { knex } = require('../internal/db');

const MAX_PREFS_BYTES = 32 * 1024;

function getUserId(req) {
  return req && req.user && (req.user.id || req.user.sub);
}

async function fetchPreferences(userId) {
  const row = await knex('users').where({ id: userId }).first('preferences');
  if (!row) return null;
  const prefs = row.preferences;
  if (prefs == null) return {};
  if (typeof prefs === 'string') {
    try {
      return JSON.parse(prefs) || {};
    } catch (_err) {
      return {};
    }
  }
  return prefs;
}

/**
 * @openapi
 * /api/user-preferences:
 *   get:
 *     summary: Get the authenticated user's UI preferences
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User preferences JSON (empty object if never set)
 *       401:
 *         description: Missing or invalid token
 */
router.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
    const prefs = await fetchPreferences(userId);
    if (prefs === null) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, data: prefs });
  } catch (err) {
    console.error('[user-preferences] GET failed', err);
    return res.status(500).json({ error: 'Failed to load preferences' });
  }
});

/**
 * @openapi
 * /api/user-preferences:
 *   put:
 *     summary: Merge a preferences patch into the authenticated user's preferences
 *     description: Shallow-merges the request body at the top level into users.preferences (JSONB). Nested objects replace existing values at their key.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Merged preferences JSON
 *       400:
 *         description: Body was not a JSON object or exceeded size limit
 *       401:
 *         description: Missing or invalid token
 */
router.put('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthenticated' });

    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const serialized = JSON.stringify(patch);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PREFS_BYTES) {
      return res.status(400).json({ error: `Preferences payload exceeds ${MAX_PREFS_BYTES} bytes` });
    }

    const current = await fetchPreferences(userId);
    if (current === null) return res.status(404).json({ error: 'User not found' });

    const merged = { ...current, ...patch };

    await knex('users').where({ id: userId }).update({ preferences: JSON.stringify(merged) });

    return res.json({ success: true, data: merged });
  } catch (err) {
    console.error('[user-preferences] PUT failed', err);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
});

module.exports = router;
