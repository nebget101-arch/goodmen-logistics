const express = require('express');
const router = express.Router();
const { query, knex } = require('../internal/db');
const auth = require('./auth-middleware');

const DEFAULT_PAGE_SIZE = 50;

router.use(auth(['admin', 'dispatch']));

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

/** Normalize display name: use legal_name or name (legacy) */
function brokerDisplayName(row) {
  return row.legal_name || row.name || null;
}

function baseBrokerSelect(qb, tid) {
  const cols = [
    'b.id',
    'b.legal_name',
    'b.name',
    'b.dba_name',
    'b.mc_number',
    'b.dot_number',
    'b.authority_type',
    'b.status',
    'b.phone',
    'b.email',
    'b.street',
    'b.city',
    'b.state',
    'b.zip',
    'b.country'
  ];

  qb.from('brokers as b');

  if (tid) {
    qb.leftJoin('tenant_broker_overrides as o', function joinOverrides() {
      this.on('o.broker_id', '=', 'b.id').andOnVal('o.tenant_id', '=', tid);
    });
    cols.push(
      'o.credit_score',
      'o.payment_rating',
      'o.broker_notes',
      knex.raw('COALESCE(o.is_blocked, false) as is_blocked'),
      knex.raw('COALESCE(o.is_preferred, false) as is_preferred')
    );
  } else {
    cols.push(
      knex.raw('NULL::numeric as credit_score'),
      knex.raw('NULL::varchar as payment_rating'),
      knex.raw('NULL::text as broker_notes'),
      knex.raw('false as is_blocked'),
      knex.raw('false as is_preferred')
    );
  }

  qb.select(cols);
  return qb;
}

function applyBrokerSearch(qb, q) {
  const term = (q || '').toString().trim();
  if (!term) return qb;
  const like = `%${term}%`;
  return qb.where(function whereSearch() {
    this.whereRaw('COALESCE(b.legal_name, b.name) ILIKE ?', [like])
      .orWhereRaw('COALESCE(b.dba_name, \'\') ILIKE ?', [like])
      .orWhereRaw('COALESCE(b.mc_number, \'\') ILIKE ?', [like])
      .orWhereRaw('COALESCE(b.dot_number, \'\') ILIKE ?', [like])
      .orWhereRaw('COALESCE(b.phone, \'\') ILIKE ?', [like]);
  });
}

async function getBrokerByIdWithOverride(id, tid) {
  const q = knex.queryBuilder();
  baseBrokerSelect(q, tid).where('b.id', id).first();
  const row = await q;
  if (!row) return null;
  return {
    ...row,
    display_name: brokerDisplayName(row)
  };
}

/** GET /api/brokers - list brokers with pagination, optional ?q= fuzzy search */
router.get('/', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const tid = tenantId(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * pageSize;

    const listQ = knex.queryBuilder();
    baseBrokerSelect(listQ, tid);
    applyBrokerSearch(listQ, q);

    const [{ total }] = await listQ
      .clone()
      .clearSelect()
      .countDistinct('b.id as total');

    const rows = await listQ
      .orderByRaw('COALESCE(b.legal_name, b.name) ASC')
      .limit(pageSize)
      .offset(offset);

    const data = (rows || []).map((r) => ({
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
    const tid = tenantId(req);
    const mcNumber = (req.params.mcNumber || '').toString().trim();
    if (!mcNumber) {
      return res.status(400).json({ success: false, error: 'MC number required' });
    }
    const rowsQ = knex.queryBuilder();
    baseBrokerSelect(rowsQ, tid)
      .where('b.mc_number', mcNumber)
      .orderByRaw('COALESCE(b.legal_name, b.name) ASC');

    const rows = await rowsQ;
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, display_name: brokerDisplayName(r) }))
    });
  } catch (err) {
    console.error('Error fetching brokers by MC:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch brokers' });
  }
});

/** GET /api/brokers/dot/:dotNumber */
router.get('/dot/:dotNumber', async (req, res) => {
  try {
    const tid = tenantId(req);
    const dotNumber = (req.params.dotNumber || '').toString().trim();
    if (!dotNumber) {
      return res.status(400).json({ success: false, error: 'DOT number required' });
    }
    const rowsQ = knex.queryBuilder();
    baseBrokerSelect(rowsQ, tid)
      .where('b.dot_number', dotNumber)
      .orderByRaw('COALESCE(b.legal_name, b.name) ASC');

    const rows = await rowsQ;
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, display_name: brokerDisplayName(r) }))
    });
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
    const tid = tenantId(req);
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
      country: (body.country || 'US').toString().trim().slice(0, 20) || 'US'
    };
    const inserted = await knex('brokers')
      .insert(row)
      .returning(['id', 'legal_name', 'name', 'dba_name', 'mc_number', 'dot_number', 'city', 'state', 'zip', 'country']);
    const created = Array.isArray(inserted) ? inserted[0] : inserted;

    const hasOverridePayload = [
      body.credit_score,
      body.payment_rating,
      body.broker_notes,
      body.notes,
      body.is_blocked,
      body.is_preferred
    ].some((v) => v !== undefined);

    if (tid && hasOverridePayload) {
      await knex('tenant_broker_overrides')
        .insert({
          tenant_id: tid,
          broker_id: created.id,
          credit_score: body.credit_score ?? null,
          payment_rating: (body.payment_rating || '').toString().trim().slice(0, 20) || null,
          broker_notes: (body.broker_notes || body.notes || '').toString().trim() || null,
          is_blocked: !!body.is_blocked,
          is_preferred: !!body.is_preferred,
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .onConflict(['tenant_id', 'broker_id'])
        .merge({
          credit_score: body.credit_score ?? null,
          payment_rating: (body.payment_rating || '').toString().trim().slice(0, 20) || null,
          broker_notes: (body.broker_notes || body.notes || '').toString().trim() || null,
          is_blocked: !!body.is_blocked,
          is_preferred: !!body.is_preferred,
          updated_at: knex.fn.now(),
        });
    }

    const merged = await getBrokerByIdWithOverride(created.id, tid);
    const out = {
      ...(merged || created),
      display_name: (merged && merged.display_name) || created.legal_name || created.name || null
    };
    res.status(201).json({ success: true, data: out });
  } catch (err) {
    console.error('Error creating broker:', err);
    res.status(500).json({ success: false, error: 'Failed to create broker' });
  }
});

/** POST /api/brokers/overrides - create/update tenant-specific broker overlay fields */
router.post('/overrides', async (req, res) => {
  try {
    if (!knex) {
      return res.status(500).json({ success: false, error: 'Database not configured' });
    }

    const tid = tenantId(req);
    if (!tid) {
      return res.status(401).json({ success: false, error: 'Tenant context required' });
    }

    const body = req.body || {};
    const brokerId = (body.broker_id || body.brokerId || '').toString().trim();
    if (!brokerId) {
      return res.status(400).json({ success: false, error: 'broker_id is required' });
    }

    const broker = await knex('brokers').where({ id: brokerId }).first('id');
    if (!broker) {
      return res.status(404).json({ success: false, error: 'Broker not found' });
    }

    await knex('tenant_broker_overrides')
      .insert({
        tenant_id: tid,
        broker_id: brokerId,
        credit_score: body.credit_score ?? null,
        payment_rating: (body.payment_rating || '').toString().trim().slice(0, 20) || null,
        broker_notes: (body.broker_notes || body.notes || '').toString().trim() || null,
        is_blocked: !!body.is_blocked,
        is_preferred: !!body.is_preferred,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .onConflict(['tenant_id', 'broker_id'])
      .merge({
        credit_score: body.credit_score ?? null,
        payment_rating: (body.payment_rating || '').toString().trim().slice(0, 20) || null,
        broker_notes: (body.broker_notes || body.notes || '').toString().trim() || null,
        is_blocked: !!body.is_blocked,
        is_preferred: !!body.is_preferred,
        updated_at: knex.fn.now(),
      });

    const merged = await getBrokerByIdWithOverride(brokerId, tid);
    res.json({ success: true, data: merged });
  } catch (err) {
    console.error('Error upserting broker override:', err);
    res.status(500).json({ success: false, error: 'Failed to save broker override' });
  }
});

module.exports = router;
