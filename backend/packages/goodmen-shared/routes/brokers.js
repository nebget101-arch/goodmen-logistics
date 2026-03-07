const express = require('express');
const router = express.Router();
const { query, knex } = require('../internal/db');
const auth = require('./auth-middleware');

const DEFAULT_PAGE_SIZE = 50;

router.use(auth(['admin', 'dispatch']));

/** Normalize display name: use legal_name or name (legacy) */
function brokerDisplayName(row) {
  return row.legal_name || row.name || null;
}

/** GET /api/brokers - list brokers with pagination, optional ?q= fuzzy search */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const selectCols = 'id, legal_name, name, dba_name, mc_number, dot_number, authority_type, status, phone, email, street, city, state, zip, country';
    let sql = `SELECT ${selectCols} FROM brokers`;
    const params = [];

    if (q) {
      params.push(`%${q}%`);
      sql += ` WHERE (
        COALESCE(legal_name, name) ILIKE $1
        OR COALESCE(dba_name, '') ILIKE $1
        OR COALESCE(mc_number, '') ILIKE $1
        OR COALESCE(dot_number, '') ILIKE $1
        OR COALESCE(phone, '') ILIKE $1
      )`;
    }

    const countSql = sql.replace(/SELECT .+ FROM/, 'SELECT COUNT(*)::int as total FROM').replace(/ORDER BY .+$/, '').replace(/LIMIT .+$/, '').replace(/OFFSET .+$/, '');
    const countResult = await query(countSql, params);
    const total = (countResult.rows && countResult.rows[0] && countResult.rows[0].total) || 0;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(pageSize, offset);
    sql += ` ORDER BY COALESCE(legal_name, name) LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const result = await query(sql, params);
    const data = (result.rows || []).map((r) => ({
      ...r,
      display_name: brokerDisplayName(r)
    }));

    res.json({
      success: true,
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 0 }
    });
  } catch (err) {
    console.error('Error fetching brokers:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch brokers' });
  }
});

/** GET /api/brokers/search?q= - fuzzy search (same logic as GET / with q) */
router.get('/search', (req, res, next) => {
  req.query.q = (req.query.q || req.query.search || '').toString().trim();
  req.url = '/';
  return router.handle(req, res, next);
});

/** GET /api/brokers/mc/:mcNumber */
router.get('/mc/:mcNumber', async (req, res) => {
  try {
    const mcNumber = (req.params.mcNumber || '').toString().trim();
    if (!mcNumber) {
      return res.status(400).json({ success: false, error: 'MC number required' });
    }
    const selectCols = 'id, legal_name, name, dba_name, mc_number, dot_number, authority_type, status, phone, email, street, city, state, zip, country';
    const result = await query(
      `SELECT ${selectCols} FROM brokers WHERE mc_number = $1 ORDER BY COALESCE(legal_name, name)`,
      [mcNumber]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching brokers by MC:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch brokers' });
  }
});

/** GET /api/brokers/dot/:dotNumber */
router.get('/dot/:dotNumber', async (req, res) => {
  try {
    const dotNumber = (req.params.dotNumber || '').toString().trim();
    if (!dotNumber) {
      return res.status(400).json({ success: false, error: 'DOT number required' });
    }
    const selectCols = 'id, legal_name, name, dba_name, mc_number, dot_number, authority_type, status, phone, email, street, city, state, zip, country';
    const result = await query(
      `SELECT ${selectCols} FROM brokers WHERE dot_number = $1 ORDER BY COALESCE(legal_name, name)`,
      [dotNumber]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching brokers by DOT:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch brokers' });
  }
});

/** POST /api/brokers - create a new broker */
router.post('/', async (req, res) => {
  try {
    if (!knex) {
      return res.status(500).json({ success: false, error: 'Database not configured' });
    }
    const body = req.body || {};
    const legalName = (body.legal_name || body.companyName || body.company_name || '').toString().trim();
    if (!legalName) {
      return res.status(400).json({ success: false, error: 'legal_name (or companyName) is required' });
    }
    const row = {
      legal_name: legalName,
      dba_name: (body.dba_name || '').toString().trim() || null,
      mc_number: (body.mc_number || body.mc || '').toString().trim() || null,
      dot_number: (body.dot_number || body.dot || '').toString().trim() || null,
      authority_type: (body.authority_type || 'Broker').toString().trim().slice(0, 20) || null,
      status: (body.status || 'Active').toString().trim().slice(0, 20) || null,
      phone: (body.phone || '').toString().trim().slice(0, 20) || null,
      email: (body.email || '').toString().trim() || null,
      street: (body.street || body.address || body.address1 || '').toString().trim() || null,
      city: (body.city || '').toString().trim().slice(0, 100) || null,
      state: (body.state || '').toString().trim().slice(0, 20) || null,
      zip: (body.zip || '').toString().trim().slice(0, 20) || null,
      country: (body.country || 'US').toString().trim().slice(0, 20) || 'US',
      broker_notes: (body.broker_notes || body.notes || '').toString().trim() || null
    };
    const inserted = await knex('brokers').insert(row).returning(['id', 'legal_name', 'dba_name', 'mc_number', 'dot_number', 'city', 'state', 'zip', 'country']);
    const created = Array.isArray(inserted) ? inserted[0] : inserted;
    const out = {
      ...created,
      display_name: created.legal_name || created.name || null
    };
    res.status(201).json({ success: true, data: out });
  } catch (err) {
    console.error('Error creating broker:', err);
    res.status(500).json({ success: false, error: 'Failed to create broker' });
  }
});

module.exports = router;
