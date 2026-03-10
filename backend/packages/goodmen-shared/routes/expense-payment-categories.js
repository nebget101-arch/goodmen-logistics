/**
 * Expense and Payment Categories API Routes
 * Handles CRUD operations for expense/payment categories
 */

const express = require('express');
const router = express.Router();
const knex = require('../config/knex');


/**
 * GET /api/expense-payment-categories
 * List all categories with optional filtering
 */
router.get('/', async (req, res) => {
  const { type, active, includeInactive } = req.query;

  try {
    let query = knex('expense_payment_categories')
      .select('*')
      .orderBy('type', 'asc')
      .orderBy('name', 'asc');

    // Filter by type (expense or revenue)
    if (type && (type === 'expense' || type === 'revenue')) {
      query = query.where('type', type);
    }

    // Filter by active status (default: only active)
    if (includeInactive !== 'true' && active !== 'false') {
      query = query.where('active', true);
    } else if (active === 'false') {
      query = query.where('active', false);
    }

    const categories = await query;

    // Build hierarchical structure with parent-child relationships
    const categoriesMap = {};
    const rootCategories = [];

    categories.forEach(cat => {
      categoriesMap[cat.code] = { ...cat, children: [] };
    });

    categories.forEach(cat => {
      if (cat.parent_code && categoriesMap[cat.parent_code]) {
        categoriesMap[cat.parent_code].children.push(categoriesMap[cat.code]);
      } else {
        rootCategories.push(categoriesMap[cat.code]);
      }
    });

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
 * GET /api/expense-payment-categories/:id
 * Get a single category by ID
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const category = await knex('expense_payment_categories')
      .where('id', id)
      .first();

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Get parent category if exists
    if (category.parent_code) {
      const parent = await knex('expense_payment_categories')
        .where('code', category.parent_code)
        .first();
      category.parent = parent;
    }

    // Get child categories
    const children = await knex('expense_payment_categories')
      .where('parent_code', category.code)
      .orderBy('name', 'asc');
    category.children = children;

    res.json({
      success: true,
      data: category
    });
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
 * POST /api/expense-payment-categories
 * Create a new custom category
 */
router.post('/', async (req, res) => {
  const { name, type, description, notes, parent_code } = req.body;

  try {
    // Validation
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'Name and type are required'
      });
    }

    if (type !== 'expense' && type !== 'revenue') {
      return res.status(400).json({
        success: false,
        error: 'Type must be either "expense" or "revenue"'
      });
    }

    // Check if parent exists
    if (parent_code) {
      const parent = await knex('expense_payment_categories')
        .where('code', parent_code)
        .first();
      if (!parent) {
        return res.status(400).json({
          success: false,
          error: 'Parent category not found'
        });
      }
    }

    // Generate next available code (start from 2000 for custom categories)
    const maxCode = await knex('expense_payment_categories')
      .max('code as maxCode')
      .first();
    const nextCode = Math.max(2000, (maxCode.maxCode || 0) + 1);

    // Insert new category
    const [newCategory] = await knex('expense_payment_categories')
      .insert({
        code: nextCode,
        parent_code: parent_code || null,
        persistent: false, // custom categories are not persistent
        name: name.trim(),
        active: true,
        type,
        description: description || '',
        notes: notes || null
      })
      .returning('*');

    res.status(201).json({
      success: true,
      data: newCategory,
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
 * PUT /api/expense-payment-categories/:id
 * Update an existing category
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, active, description, notes, parent_code } = req.body;

  try {
    // Check if category exists
    const existingCategory = await knex('expense_payment_categories')
      .where('id', id)
      .first();

    if (!existingCategory) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Prevent modifying persistent system categories' core fields
    if (existingCategory.persistent && (name !== undefined || parent_code !== undefined)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot modify name or parent of system-defined categories'
      });
    }

    // Build update object
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (active !== undefined) updates.active = active;
    if (description !== undefined) updates.description = description;
    if (notes !== undefined) updates.notes = notes;
    if (parent_code !== undefined) {
      // Validate parent exists and prevent circular references
      if (parent_code) {
        const parent = await knex('expense_payment_categories')
          .where('code', parent_code)
          .first();
        if (!parent) {
          return res.status(400).json({
            success: false,
            error: 'Parent category not found'
          });
        }
        if (parent.code === existingCategory.code) {
          return res.status(400).json({
            success: false,
            error: 'Category cannot be its own parent'
          });
        }
      }
      updates.parent_code = parent_code;
    }

    updates.updated_at = knex.fn.now();

    // Update category
    await knex('expense_payment_categories')
      .where('id', id)
      .update(updates);

    // Fetch updated category
    const updatedCategory = await knex('expense_payment_categories')
      .where('id', id)
      .first();

    res.json({
      success: true,
      data: updatedCategory,
      message: 'Category updated successfully'
    });
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
 * DELETE /api/expense-payment-categories/:id
 * Delete a custom category (soft delete by setting active=false)
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { hardDelete } = req.query;

  try {
    // Check if category exists
    const category = await knex('expense_payment_categories')
      .where('id', id)
      .first();

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Prevent deleting persistent system categories
    if (category.persistent) {
      return res.status(403).json({
        success: false,
        error: 'Cannot delete system-defined categories'
      });
    }

    // Check if category is in use
    const usageInAdjustments = await knex('settlement_adjustment_items')
      .where('category_id', id)
      .count('* as count')
      .first();

    const usageInImported = await knex('imported_expense_items')
      .where('category_id', id)
      .count('* as count')
      .first();

    const totalUsage = parseInt(usageInAdjustments.count) + parseInt(usageInImported.count);

    if (totalUsage > 0 && hardDelete === 'true') {
      return res.status(400).json({
        success: false,
        error: 'Cannot hard delete category that is in use',
        usage: totalUsage
      });
    }

    if (hardDelete === 'true') {
      // Hard delete (only if not in use)
      await knex('expense_payment_categories')
        .where('id', id)
        .delete();

      res.json({
        success: true,
        message: 'Category deleted permanently'
      });
    } else {
      // Soft delete (set active to false)
      await knex('expense_payment_categories')
        .where('id', id)
        .update({
          active: false,
          updated_at: knex.fn.now()
        });

      res.json({
        success: true,
        message: 'Category deactivated',
        note: totalUsage > 0 ? `This category is used in ${totalUsage} transaction(s)` : undefined
      });
    }
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
 * GET /api/expense-payment-categories/stats/usage
 * Get usage statistics for categories
 */
router.get('/stats/usage', async (req, res) => {
  try {
    const stats = await knex('expense_payment_categories as epc')
      .leftJoin('settlement_adjustment_items as sai', 'epc.id', 'sai.category_id')
      .leftJoin('imported_expense_items as iei', 'epc.id', 'iei.category_id')
      .select(
        'epc.id',
        'epc.code',
        'epc.name',
        'epc.type',
        'epc.active',
        knex.raw('COUNT(DISTINCT sai.id) as settlement_usage'),
        knex.raw('COUNT(DISTINCT iei.id) as imported_usage'),
        knex.raw('COUNT(DISTINCT sai.id) + COUNT(DISTINCT iei.id) as total_usage')
      )
      .groupBy('epc.id', 'epc.code', 'epc.name', 'epc.type', 'epc.active')
      .orderBy('total_usage', 'desc');

    res.json({
      success: true,
      data: stats
    });
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
