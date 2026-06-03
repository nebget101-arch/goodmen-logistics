/**
 * In-app notification bell routes — FN-507
 *
 * GET    /api/notifications           — list notifications for current user
 * GET    /api/notifications/unread-count — count of unread (for badge)
 * PATCH  /api/notifications/:id/read  — mark one as read
 * PATCH  /api/notifications/read-all  — mark all as read for current user
 */

const express = require('express');
const router = express.Router();
const path = require('path');

const sharedRoot = path.join(__dirname, '..');
const knex = require(path.join(sharedRoot, 'config', 'knex'));

// ---------------------------------------------------------------------------
// GET /api/notifications
// Query: is_read (true|false), type, limit (default 50), offset (default 0)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const userId = req.user?.id;
  const { tenantId } = req;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { is_read, type, limit = 50, offset = 0 } = req.query;

  try {
    const hasTable = await knex.schema.hasTable('user_notifications').catch(() => false);
    if (!hasTable) return res.json({ notifications: [], total: 0 });

    const query = knex('user_notifications')
      .where('user_id', userId)
      .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
      .modify((q) => { if (is_read !== undefined) q.where('is_read', is_read === 'true'); })
      .modify((q) => { if (type) q.where('type', type); })
      .orderBy('created_at', 'desc');

    const [{ total }] = await query.clone().count('id as total');
    const notifications = await query.select('*').limit(Number(limit)).offset(Number(offset));

    return res.json({ notifications, total: Number(total) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------
router.get('/unread-count', async (req, res) => {
  const userId = req.user?.id;
  const { tenantId } = req;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hasTable = await knex.schema.hasTable('user_notifications').catch(() => false);
    if (!hasTable) return res.json({ count: 0 });

    const [{ count }] = await knex('user_notifications')
      .where({ user_id: userId, is_read: false })
      .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
      .count('id as count');

    return res.json({ count: Number(count) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/read-all  (must appear before /:id)
// ---------------------------------------------------------------------------
router.patch('/read-all', async (req, res) => {
  const userId = req.user?.id;
  const { tenantId } = req;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hasTable = await knex.schema.hasTable('user_notifications').catch(() => false);
    if (!hasTable) return res.json({ updated: 0 });

    const updated = await knex('user_notifications')
      .where({ user_id: userId, is_read: false })
      .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
      .update({ is_read: true, read_at: knex.fn.now() });

    return res.json({ updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/notifications/:id/read
// ---------------------------------------------------------------------------
router.patch('/:id/read', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const { tenantId } = req;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const hasTable = await knex.schema.hasTable('user_notifications').catch(() => false);
    if (!hasTable) return res.status(404).json({ error: 'Not found' });

    const existing = await knex('user_notifications')
      .where({ id, user_id: userId })
      .modify((q) => { if (tenantId) q.where('tenant_id', tenantId); })
      .first();

    if (!existing) return res.status(404).json({ error: 'Notification not found' });

    const [updated] = await knex('user_notifications')
      .where({ id })
      .update({ is_read: true, read_at: knex.fn.now() })
      .returning('*');

    return res.json({ notification: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
