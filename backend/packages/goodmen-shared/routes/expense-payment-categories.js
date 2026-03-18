/**
 * Expense and Payment Categories API Routes
 * Handles CRUD operations for global + tenant custom categories.
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');

function tenantId(req) {
  return req.context?.tenantId || req.user?.tenantId || req.user?.tenant_id || null;
}

function queryOptionsFromReq(req) {
  const { type, active, includeInactive } = req.query;
  return { type, active, includeInactive };
}

function appendFilterClauses(sqlParts, bindings, alias, options) {
  if (options.type && (options.type === 'expense' || options.type === 'revenue')) {
    sqlParts.push(`${alias}.type = ?`);
    bindings.push(options.type);
  }

  if (options.includeInactive !== 'true' && options.active !== 'false') {
    sqlParts.push(`${alias}.active = true`);
  } else if (options.active === 'false') {
    sqlParts.push(`${alias}.active = false`);
  }
}

async function listMergedCategories(req, options = queryOptionsFromReq(req)) {
  const tid = tenantId(req);
  const globalWhere = ['1 = 1'];
  const globalBindings = [];
  appendFilterClauses(globalWhere, globalBindings, 'gec', options);

  let sql = `
    SELECT
      gec.id,
      gec.code,
      gec.parent_code,
      gec.persistent,
      gec.name,
      gec.active,
      gec.type,
      gec.description,
      gec.notes,
      gec.created_at,
      gec.updated_at,
      'global'::text AS source
    FROM global_expense_categories gec
    WHERE ${globalWhere.join(' AND ')}
  `;

  const bindings = [...globalBindings];

  if (tid) {
    const customWhere = ['epc.tenant_id = ?', 'NOT EXISTS (SELECT 1 FROM global_expense_categories g2 WHERE g2.code = epc.code)'];
    const customBindings = [tid];
    appendFilterClauses(customWhere, customBindings, 'epc', options);

    sql += `
      UNION ALL
      SELECT
        epc.id,
        epc.code,
        epc.parent_code,
        epc.persistent,
        epc.name,
        epc.active,
        epc.type,
        epc.description,
        epc.notes,
        epc.created_at,
        epc.updated_at,
        'custom'::text AS source
      FROM expense_payment_categories epc
      WHERE ${customWhere.join(' AND ')}
    `;
    bindings.push(...customBindings);
  }

  sql += ' ORDER BY type ASC, name ASC';
  const result = await knex.raw(sql, bindings);
  return result.rows || [];
}

function buildHierarchy(categories) {
  const categoriesMap = {};
  const rootCategories = [];

  categories.forEach((cat) => {
    categoriesMap[cat.code] = { ...cat, children: [] };
  });

  categories.forEach((cat) => {
    if (cat.parent_code && categoriesMap[cat.parent_code]) {
      categoriesMap[cat.parent_code].children.push(categoriesMap[cat.code]);
    } else {
      rootCategories.push(categoriesMap[cat.code]);
    }
  });

  return rootCategories;
}

async function findAccessibleCategoryByCode(req, code) {
  const tid = tenantId(req);
  const globalCategory = await knex('global_expense_categories').where({ code }).first();
  if (globalCategory) return { ...globalCategory, source: 'global' };
  if (!tid) return null;
  const customCategory = await knex('expense_payment_categories').where({ tenant_id: tid, code }).first();
  return customCategory ? { ...customCategory, source: 'custom' } : null;
}

async function findCategoryById(req, id) {
  const tid = tenantId(req);
  const globalCategory = await knex('global_expense_categories').where({ id }).first();
  if (globalCategory) return { ...globalCategory, source: 'global' };
  if (!tid) return null;
  const customCategory = await knex('expense_payment_categories').where({ id, tenant_id: tid }).first();
  return customCategory ? { ...customCategory, source: 'custom' } : null;
}

router.get('/', async (req, res) => {
  try {
    const categories = await listMergedCategories(req);
    const rootCategories = buildHierarchy(categories);

    res.json({
      success: true,
      data: rootCategories,
      total: categories.length
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
      message: error.message
    });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const category = await findCategoryById(req, id);

    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    if (category.parent_code) {
      category.parent = await findAccessibleCategoryByCode(req, category.parent_code);
    }

    const merged = await listMergedCategories(req, { includeInactive: 'true' });
    category.children = merged
      .filter((row) => row.parent_code === category.code)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: category });
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category',
      message: error.message
    });
  }
});

router.post('/', async (req, res) => {
  const { name, type, description, notes, parent_code } = req.body;

  try {
    const tid = tenantId(req);
    if (!tid) {
      return res.status(401).json({ success: false, error: 'Tenant context required' });
    }

    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'Name and type are required' });
    }

    if (type !== 'expense' && type !== 'revenue') {
      return res.status(400).json({ success: false, error: 'Type must be either "expense" or "revenue"' });
    }

    if (parent_code) {
      const parent = await findAccessibleCategoryByCode(req, parent_code);
      if (!parent) {
        return res.status(400).json({ success: false, error: 'Parent category not found' });
      }
    }

    const maxTenantCode = await knex('expense_payment_categories').where({ tenant_id: tid }).max('code as maxCode').first();
    const maxGlobalCode = await knex('global_expense_categories').max('code as maxCode').first();
    const nextCode = Math.max(2000, Number(maxTenantCode.maxCode || 0) + 1, Number(maxGlobalCode.maxCode || 0) + 1);

    const [newCategory] = await knex('expense_payment_categories')
      .insert({
        tenant_id: tid,
        code: nextCode,
        parent_code: parent_code || null,
        persistent: false,
        name: name.trim(),
        active: true,
        type,
        description: description || '',
        notes: notes || null
      })
      .returning('*');

    res.status(201).json({
      success: true,
      data: { ...newCategory, source: 'custom' },
      message: 'Category created successfully'
    });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category',
      message: error.message
    });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, active, description, notes, parent_code } = req.body;

  try {
    const tid = tenantId(req);
    if (!tid) {
      return res.status(401).json({ success: false, error: 'Tenant context required' });
    }

    const globalCategory = await knex('global_expense_categories').where({ id }).first();
    if (globalCategory) {
      return res.status(403).json({ success: false, error: 'Cannot edit global categories' });
    }

    const existingCategory = await knex('expense_payment_categories').where({ id, tenant_id: tid }).first();
    if (!existingCategory) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    if (existingCategory.persistent && (name !== undefined || parent_code !== undefined)) {
      return res.status(403).json({ success: false, error: 'Cannot modify name or parent of system-defined categories' });
    }

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (active !== undefined) updates.active = active;
    if (description !== undefined) updates.description = description;
    if (notes !== undefined) updates.notes = notes;
    if (parent_code !== undefined) {
      if (parent_code) {
        const parent = await findAccessibleCategoryByCode(req, parent_code);
        if (!parent) {
          return res.status(400).json({ success: false, error: 'Parent category not found' });
        }
        if (parent.code === existingCategory.code) {
          return res.status(400).json({ success: false, error: 'Category cannot be its own parent' });
        }
      }
      updates.parent_code = parent_code;
    }

    updates.updated_at = knex.fn.now();

    await knex('expense_payment_categories').where({ id, tenant_id: tid }).update(updates);
    const updatedCategory = await knex('expense_payment_categories').where({ id, tenant_id: tid }).first();

    res.json({ success: true, data: { ...updatedCategory, source: 'custom' }, message: 'Category updated successfully' });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update category',
      message: error.message
    });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { hardDelete } = req.query;

  try {
    const tid = tenantId(req);
    if (!tid) {
      return res.status(401).json({ success: false, error: 'Tenant context required' });
    }

    const globalCategory = await knex('global_expense_categories').where({ id }).first();
    if (globalCategory) {
      return res.status(403).json({ success: false, error: 'Cannot delete global categories' });
    }

    const category = await knex('expense_payment_categories').where({ id, tenant_id: tid }).first();
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    if (category.persistent) {
      return res.status(403).json({ success: false, error: 'Cannot delete system-defined categories' });
    }

    const usageInAdjustments = await knex('settlement_adjustment_items').where('category_id', id).count('* as count').first();
    const usageInImported = await knex('imported_expense_items').where('category_id', id).count('* as count').first();
    const totalUsage = parseInt(usageInAdjustments.count, 10) + parseInt(usageInImported.count, 10);

    if (totalUsage > 0 && hardDelete === 'true') {
      return res.status(400).json({ success: false, error: 'Cannot hard delete category that is in use', usage: totalUsage });
    }

    if (hardDelete === 'true') {
      await knex('expense_payment_categories').where({ id, tenant_id: tid }).delete();
      return res.json({ success: true, message: 'Category deleted permanently' });
    }

    await knex('expense_payment_categories').where({ id, tenant_id: tid }).update({
      active: false,
      updated_at: knex.fn.now()
    });

    return res.json({
      success: true,
      message: 'Category deactivated',
      note: totalUsage > 0 ? `This category is used in ${totalUsage} transaction(s)` : undefined
    });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category',
      message: error.message
    });
  }
});

router.get('/stats/usage', async (req, res) => {
  try {
    const tid = tenantId(req);
    const bindings = tid ? [tid] : [];
    const stats = await knex.raw(`
      WITH categories AS (
        SELECT gec.id, gec.code, gec.name, gec.type, gec.active, 'global'::text AS source
        FROM global_expense_categories gec
        UNION ALL
        SELECT epc.id, epc.code, epc.name, epc.type, epc.active, 'custom'::text AS source
        FROM expense_payment_categories epc
        ${tid ? 'WHERE epc.tenant_id = ? AND NOT EXISTS (SELECT 1 FROM global_expense_categories g2 WHERE g2.code = epc.code)' : 'WHERE 1 = 0'}
      )
      SELECT
        c.id,
        c.code,
        c.name,
        c.type,
        c.active,
        c.source,
        COUNT(DISTINCT sai.id) as settlement_usage,
        COUNT(DISTINCT iei.id) as imported_usage,
        COUNT(DISTINCT sai.id) + COUNT(DISTINCT iei.id) as total_usage
      FROM categories c
      LEFT JOIN settlement_adjustment_items sai ON c.id = sai.category_id
      LEFT JOIN imported_expense_items iei ON c.id = iei.category_id
      GROUP BY c.id, c.code, c.name, c.type, c.active, c.source
      ORDER BY total_usage DESC, c.name ASC
    `, bindings);

    res.json({ success: true, data: stats.rows });
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category statistics',
      message: error.message
    });
  }
});

module.exports = router;
