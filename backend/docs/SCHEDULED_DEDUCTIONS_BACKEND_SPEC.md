# Backend Implementation: Scheduled Deductions & Expense Responsibility Integration

## Overview
This document outlines the backend requirements for the Scheduled Deductions feature. The feature enables recurring payroll deductions linked to expense responsibility profiles, allowing automatic calculation of driver expenses based on configurable rules.

## Current State
The backend already has partial implementation:
- **Table**: `recurring_deduction_rules` exists in the database
- **Endpoints**: Basic CRUD endpoints exist at `/api/settlements/recurring-deductions`
  - `GET /api/settlements/recurring-deductions` - List deductions
  - `POST /api/settlements/recurring-deductions` - Create deduction
  - `PATCH /api/settlements/recurring-deductions/:id` - Update deduction

## Required Enhancements

### 1. Database Schema Verification

Ensure the `recurring_deduction_rules` table has these columns:

```sql
CREATE TABLE IF NOT EXISTS recurring_deduction_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
  payee_id UUID REFERENCES payees(id) ON DELETE SET NULL,
  equipment_id UUID REFERENCES equipment(id) ON DELETE SET NULL,
  rule_scope VARCHAR(50) NOT NULL, -- 'driver', 'payee', 'equipment', 'global'
  description VARCHAR(500) NOT NULL,
  amount_type VARCHAR(20) NOT NULL, -- 'fixed' or 'percentage'
  amount DECIMAL(10, 2) NOT NULL,
  frequency VARCHAR(50) NOT NULL, -- 'weekly', 'biweekly', 'monthly', 'per_settlement'
  start_date DATE NOT NULL,
  end_date DATE,
  source_type VARCHAR(100), -- 'fuel', 'insurance', 'eld', 'trailer_rent', 'toll', 'repairs', etc.
  applies_when VARCHAR(100), -- 'always', 'has_load', 'specific_expense', 'over_threshold'
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recurring_deductions_driver ON recurring_deduction_rules(driver_id);
CREATE INDEX idx_recurring_deductions_enabled ON recurring_deduction_rules(enabled);
CREATE INDEX idx_recurring_deductions_dates ON recurring_deduction_rules(start_date, end_date);
```

### 2. Expense Responsibility Profile Link

Ensure the `expense_responsibility_profiles` table exists and links to `driver_compensation_profiles`:

```sql
CREATE TABLE IF NOT EXISTS expense_responsibility_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compensation_profile_id UUID REFERENCES driver_compensation_profiles(id) ON DELETE CASCADE,
  fuel DECIMAL(5, 2) DEFAULT 100.00, -- percentage
  insurance DECIMAL(5, 2) DEFAULT 0.00,
  eld DECIMAL(5, 2) DEFAULT 0.00,
  trailer_rent DECIMAL(5, 2) DEFAULT 0.00,
  toll DECIMAL(5, 2) DEFAULT 0.00,
  repairs DECIMAL(5, 2) DEFAULT 100.00,
  ifta DECIMAL(5, 2) DEFAULT 0.00,
  other DECIMAL(5, 2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_expense_responsibility_comp_profile 
  ON expense_responsibility_profiles(compensation_profile_id);
```

### 3. Enhanced GET Endpoint

**Location**: `backend/packages/goodmen-shared/routes/settlements.js` (around line 598)

**Current implementation returns raw database records. Enhance to include:**

```javascript
router.get('/recurring-deductions', async (req, res) => {
  try {
    const { driver_id, enabled } = req.query;

    let query = db('recurring_deduction_rules as rdr')
      .select(
        'rdr.*',
        'drivers.first_name as driver_first_name',
        'drivers.last_name as driver_last_name',
        'payees.name as payee_name',
        'payees.type as payee_type'
      )
      .leftJoin('drivers', 'rdr.driver_id', 'drivers.id')
      .leftJoin('payees', 'rdr.payee_id', 'payees.id')
      .orderBy('rdr.created_at', 'desc');

    // Apply filters
    if (driver_id) {
      query = query.where('rdr.driver_id', driver_id);
    }
    if (enabled !== undefined) {
      query = query.where('rdr.enabled', enabled === 'true');
    }

    const rules = await query;

    // Format response with enriched data
    const formattedRules = rules.map(rule => ({
      id: rule.id,
      driver_id: rule.driver_id,
      driver_name: rule.driver_first_name && rule.driver_last_name 
        ? `${rule.driver_first_name} ${rule.driver_last_name}` 
        : null,
      payee_id: rule.payee_id,
      payee_name: rule.payee_name,
      payee_type: rule.payee_type,
      equipment_id: rule.equipment_id,
      rule_scope: rule.rule_scope,
      description: rule.description,
      amount_type: rule.amount_type,
      amount: parseFloat(rule.amount),
      frequency: rule.frequency,
      start_date: rule.start_date,
      end_date: rule.end_date,
      source_type: rule.source_type,
      applies_when: rule.applies_when,
      enabled: rule.enabled,
      created_at: rule.created_at,
      updated_at: rule.updated_at
    }));

    res.json(formattedRules);
  } catch (err) {
    console.error('Error fetching recurring deductions:', err);
    res.status(500).json({ error: 'Failed to fetch recurring deductions' });
  }
});
```

### 4. POST Endpoint Validation

**Location**: Same file (around line 620)

Ensure the POST endpoint validates required fields and business rules:

```javascript
router.post('/recurring-deductions', async (req, res) => {
  try {
    const {
      driver_id,
      payee_id,
      equipment_id,
      rule_scope,
      description,
      amount_type,
      amount,
      frequency,
      start_date,
      end_date,
      source_type,
      applies_when,
      enabled = true
    } = req.body;

    // Validation
    if (!rule_scope) {
      return res.status(400).json({ error: 'rule_scope is required' });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (!amount_type || !['fixed', 'percentage'].includes(amount_type)) {
      return res.status(400).json({ error: 'amount_type must be "fixed" or "percentage"' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be greater than 0' });
    }
    if (amount_type === 'percentage' && amount > 100) {
      return res.status(400).json({ error: 'percentage amount cannot exceed 100' });
    }
    if (!frequency) {
      return res.status(400).json({ error: 'frequency is required' });
    }
    if (!start_date) {
      return res.status(400).json({ error: 'start_date is required' });
    }

    // Business logic validation
    if (rule_scope === 'driver' && !driver_id) {
      return res.status(400).json({ error: 'driver_id is required when rule_scope is "driver"' });
    }
    if (rule_scope === 'payee' && !payee_id) {
      return res.status(400).json({ error: 'payee_id is required when rule_scope is "payee"' });
    }
    if (applies_when === 'specific_expense' && !source_type) {
      return res.status(400).json({ error: 'source_type is required when applies_when is "specific_expense"' });
    }

    const [newRule] = await db('recurring_deduction_rules')
      .insert({
        driver_id,
        payee_id,
        equipment_id,
        rule_scope,
        description,
        amount_type,
        amount,
        frequency,
        start_date,
        end_date,
        source_type,
        applies_when,
        enabled
      })
      .returning('*');

    res.status(201).json(newRule);
  } catch (err) {
    console.error('Error creating recurring deduction:', err);
    res.status(500).json({ error: 'Failed to create recurring deduction' });
  }
});
```

### 5. PATCH Endpoint Enhancement

**Location**: Same file (around line 640)

Enhance to support updating more fields, not just enabled/end_date:

```javascript
router.patch('/recurring-deductions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = [
      'description',
      'amount_type',
      'amount',
      'frequency',
      'end_date',
      'enabled',
      'applies_when',
      'source_type'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updated_at = new Date();

    const [updated] = await db('recurring_deduction_rules')
      .where({ id })
      .update(updates)
      .returning('*');

    if (!updated) {
      return res.status(404).json({ error: 'Recurring deduction not found' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Error updating recurring deduction:', err);
    res.status(500).json({ error: 'Failed to update recurring deduction' });
  }
});
```

### 6. Settlement Calculation Integration

**Location**: `backend/packages/goodmen-shared/services/settlement-calculation.js`

The settlement calculation engine should apply recurring deductions automatically. Add this logic to the settlement calculation:

```javascript
async function applyRecurringDeductions(settlement, settlementDate) {
  const deductions = await db('recurring_deduction_rules as rdr')
    .where('rdr.enabled', true)
    .where('rdr.start_date', '<=', settlementDate)
    .where(function() {
      this.whereNull('rdr.end_date')
        .orWhere('rdr.end_date', '>=', settlementDate);
    })
    .where(function() {
      this.where('rdr.rule_scope', 'global')
        .orWhere(function() {
          this.where('rdr.rule_scope', 'driver')
            .where('rdr.driver_id', settlement.driver_id);
        })
        .orWhere(function() {
          this.where('rdr.rule_scope', 'payee')
            .where('rdr.payee_id', settlement.primary_payee_id);
        });
    });

  let totalDeductions = 0;

  for (const rule of deductions) {
    // Check applies_when condition
    if (rule.applies_when === 'has_load' && !settlement.load_id) {
      continue; // Skip if no load
    }

    if (rule.applies_when === 'specific_expense') {
      // Check if settlement has matching expense type
      const hasExpense = await db('settlement_expenses')
        .where('settlement_id', settlement.id)
        .where('expense_type', rule.source_type)
        .first();
      
      if (!hasExpense) continue;
    }

    // Calculate deduction amount
    let deductionAmount = 0;
    if (rule.amount_type === 'fixed') {
      deductionAmount = parseFloat(rule.amount);
    } else if (rule.amount_type === 'percentage') {
      // Apply percentage to gross settlement
      deductionAmount = (settlement.gross_amount * parseFloat(rule.amount)) / 100;
    }

    // Store deduction detail
    await db('settlement_deductions').insert({
      settlement_id: settlement.id,
      recurring_rule_id: rule.id,
      description: rule.description,
      amount: deductionAmount,
      source_type: rule.source_type || 'recurring_deduction'
    });

    totalDeductions += deductionAmount;
  }

  return totalDeductions;
}

// Call this in calculateSettlement() after calculating gross but before net:
const recurringDeductions = await applyRecurringDeductions(settlement, settlementDate);
settlement.total_deductions = (settlement.total_deductions || 0) + recurringDeductions;
settlement.net_amount = settlement.gross_amount - settlement.total_deductions;
```

### 7. Settlement Deductions Table (if not exists)

Create a table to track which deductions were applied to each settlement:

```sql
CREATE TABLE IF NOT EXISTS settlement_deductions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  recurring_rule_id UUID REFERENCES recurring_deduction_rules(id) ON DELETE SET NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  source_type VARCHAR(100), -- 'recurring_deduction', 'fuel', 'insurance', etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlement_deductions_settlement ON settlement_deductions(settlement_id);
CREATE INDEX idx_settlement_deductions_rule ON settlement_deductions(recurring_rule_id);
```

## Frontend Integration Points

The frontend will call these endpoints:

1. **Load deductions**: `GET /api/settlements/recurring-deductions?driver_id={id}&enabled=true`
2. **Create deduction**: `POST /api/settlements/recurring-deductions` with full payload
3. **Toggle enabled**: `PATCH /api/settlements/recurring-deductions/{id}` with `{ enabled: false }`
4. **Update end date**: `PATCH /api/settlements/recurring-deductions/{id}` with `{ end_date: "2024-12-31" }`

## Testing Checklist

- [ ] Verify GET endpoint returns enriched data with driver/payee names
- [ ] Test POST validation (missing required fields should return 400)
- [ ] Test PATCH updates (enabled toggle, end_date, etc.)
- [ ] Verify deductions are applied correctly in settlement calculation
- [ ] Test percentage-based deductions calculate correctly
- [ ] Test date range filtering (start_date, end_date)
- [ ] Test rule_scope filtering (driver, payee, equipment, global)
- [ ] Test applies_when conditions (always, has_load, specific_expense)
- [ ] Verify settlement_deductions table captures applied deductions
- [ ] Test cascading deletes (deleting driver/payee doesn't break)

## Field Reference

### rule_scope
- `driver`: Applies to specific driver
- `payee`: Applies to specific payee
- `equipment`: Applies to specific equipment
- `global`: Applies to all settlements

### amount_type
- `fixed`: Dollar amount (e.g., $50.00)
- `percentage`: Percentage of gross settlement (e.g., 10%)

### frequency
- `weekly`: Deducted every week
- `biweekly`: Deducted every two weeks
- `monthly`: Deducted monthly
- `per_settlement`: Deducted from each settlement

### applies_when
- `always`: Applied to every settlement
- `has_load`: Only when settlement has a load
- `specific_expense`: Only when specific expense type exists
- `over_threshold`: Only when settlement exceeds amount threshold

### source_type (expense types)
- `fuel`: Fuel expenses
- `insurance`: Insurance premiums
- `eld`: Electronic logging device fees
- `trailer_rent`: Trailer rental fees
- `toll`: Toll charges
- `repairs`: Repair and maintenance
- `ifta`: IFTA fuel tax
- `other`: Other miscellaneous expenses

## Priority Implementation Order

1. **HIGH**: Enhance GET endpoint to include driver/payee names (frontend needs this immediately)
2. **HIGH**: Add POST validation for business rules
3. **MEDIUM**: Enhance PATCH to support more fields
4. **MEDIUM**: Create settlement_deductions tracking table
5. **LOW**: Integrate automatic deduction application in settlement calculation

## Notes

- The frontend is already built and ready to integrate
- Existing endpoints work but need enrichment with JOIN data
- Settlement calculation integration can be phase 2 (manual for now)
- Focus on CRUD operations first, automation second
