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

/**
 * @openapi
 * /api/expense-payment-categories:
 *   get:
 *     summary: List merged expense/payment categories
 *     description: >
 *       Returns all categories visible to the current tenant, merging global
 *       (system-defined) categories with tenant-scoped custom categories.
 *       Results are returned as a hierarchy with parent/child relationships.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [expense, revenue]
 *         description: Filter categories by type
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: Filter by active status. "false" returns only inactive categories.
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: When "true", includes both active and inactive categories.
 *     responses:
 *       200:
 *         description: Hierarchical list of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   description: Root-level categories, each with a children array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       code:
 *                         type: integer
 *                       parent_code:
 *                         type: integer
 *                         nullable: true
 *                       persistent:
 *                         type: boolean
 *                       name:
 *                         type: string
 *                       active:
 *                         type: boolean
 *                       type:
 *                         type: string
 *                         enum: [expense, revenue]
 *                       description:
 *                         type: string
 *                       notes:
 *                         type: string
 *                         nullable: true
 *                       source:
 *                         type: string
 *                         enum: [global, custom]
 *                       children:
 *                         type: array
 *                         items:
 *                           type: object
 *                 total:
 *                   type: integer
 *                   description: Total flat count of categories (before hierarchy)
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/expense-payment-categories/{id}:
 *   get:
 *     summary: Get a single category by ID
 *     description: >
 *       Returns a single category (global or custom) by its primary key.
 *       The response includes the resolved parent object (if parent_code exists)
 *       and an array of direct children.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Category primary key
 *     responses:
 *       200:
 *         description: Category with parent and children
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     code:
 *                       type: integer
 *                     parent_code:
 *                       type: integer
 *                       nullable: true
 *                     persistent:
 *                       type: boolean
 *                     name:
 *                       type: string
 *                     active:
 *                       type: boolean
 *                     type:
 *                       type: string
 *                       enum: [expense, revenue]
 *                     description:
 *                       type: string
 *                     notes:
 *                       type: string
 *                       nullable: true
 *                     source:
 *                       type: string
 *                       enum: [global, custom]
 *                     parent:
 *                       type: object
 *                       nullable: true
 *                       description: Resolved parent category (if parent_code is set)
 *                     children:
 *                       type: array
 *                       description: Direct child categories sorted by name
 *                       items:
 *                         type: object
 *       404:
 *         description: Category not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
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

/**
 * @openapi
 * /api/expense-payment-categories:
 *   post:
 *     summary: Create a custom category
 *     description: >
 *       Creates a new tenant-scoped custom category. Requires name and type.
 *       The code is auto-assigned (starting at 2000+). An optional parent_code
 *       can be provided to nest the category under an existing parent.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name for the category
 *               type:
 *                 type: string
 *                 enum: [expense, revenue]
 *                 description: Category type
 *               description:
 *                 type: string
 *                 description: Optional description
 *               notes:
 *                 type: string
 *                 nullable: true
 *                 description: Optional internal notes
 *               parent_code:
 *                 type: integer
 *                 nullable: true
 *                 description: Code of the parent category to nest under
 *     responses:
 *       201:
 *         description: Category created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     code:
 *                       type: integer
 *                     parent_code:
 *                       type: integer
 *                       nullable: true
 *                     persistent:
 *                       type: boolean
 *                       example: false
 *                     name:
 *                       type: string
 *                     active:
 *                       type: boolean
 *                       example: true
 *                     type:
 *                       type: string
 *                       enum: [expense, revenue]
 *                     description:
 *                       type: string
 *                     notes:
 *                       type: string
 *                       nullable: true
 *                     source:
 *                       type: string
 *                       example: custom
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error (missing name/type, invalid type, or invalid parent_code)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       401:
 *         description: Tenant context required
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/expense-payment-categories/{id}:
 *   put:
 *     summary: Update a custom category
 *     description: >
 *       Updates a tenant-scoped custom category. Global categories cannot be
 *       edited. Persistent (system-defined) categories allow only active,
 *       description, and notes updates -- name and parent_code are locked.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Category primary key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Updated display name
 *               active:
 *                 type: boolean
 *                 description: Activate or deactivate the category
 *               description:
 *                 type: string
 *                 description: Updated description
 *               notes:
 *                 type: string
 *                 nullable: true
 *                 description: Updated internal notes
 *               parent_code:
 *                 type: integer
 *                 nullable: true
 *                 description: New parent code (null to make root-level)
 *     responses:
 *       200:
 *         description: Category updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     code:
 *                       type: integer
 *                     name:
 *                       type: string
 *                     active:
 *                       type: boolean
 *                     type:
 *                       type: string
 *                     source:
 *                       type: string
 *                       example: custom
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid parent_code or self-referencing parent
 *       401:
 *         description: Tenant context required
 *       403:
 *         description: Cannot edit global or persistent categories
 *       404:
 *         description: Category not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/expense-payment-categories/{id}:
 *   delete:
 *     summary: Delete or deactivate a custom category
 *     description: >
 *       Soft-deletes (deactivates) a tenant-scoped custom category by default.
 *       Pass ?hardDelete=true for permanent removal (only if the category has
 *       zero usage in settlement adjustments and imported expenses). Global and
 *       persistent categories cannot be deleted.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Category primary key
 *       - in: query
 *         name: hardDelete
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *         description: >
 *           When "true", permanently deletes the category instead of
 *           deactivating it. Fails if the category is in use.
 *     responses:
 *       200:
 *         description: Category deleted or deactivated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   description: '"Category deleted permanently" or "Category deactivated"'
 *                 note:
 *                   type: string
 *                   nullable: true
 *                   description: Usage note when soft-deleting a category that is referenced by transactions
 *       400:
 *         description: Cannot hard-delete a category that is in use
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 usage:
 *                   type: integer
 *                   description: Number of transactions referencing this category
 *       401:
 *         description: Tenant context required
 *       403:
 *         description: Cannot delete global or system-defined categories
 *       404:
 *         description: Category not found
 *       500:
 *         description: Server error
 */
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

/**
 * @openapi
 * /api/expense-payment-categories/stats/usage:
 *   get:
 *     summary: Get usage statistics for all categories
 *     description: >
 *       Returns every category (global + tenant custom) with counts of how many
 *       settlement adjustment items and imported expense items reference it.
 *       Results are sorted by total usage descending.
 *     tags:
 *       - Expense Categories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of categories with usage counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       code:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [expense, revenue]
 *                       active:
 *                         type: boolean
 *                       source:
 *                         type: string
 *                         enum: [global, custom]
 *                       settlement_usage:
 *                         type: integer
 *                         description: Count of settlement_adjustment_items referencing this category
 *                       imported_usage:
 *                         type: integer
 *                         description: Count of imported_expense_items referencing this category
 *                       total_usage:
 *                         type: integer
 *                         description: Sum of settlement_usage and imported_usage
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                 message:
 *                   type: string
 */
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
