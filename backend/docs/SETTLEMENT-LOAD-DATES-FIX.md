# Settlement Load Dates Fix

## Problem
Load earnings table in settlement detail page was showing "—" for pickup and/or delivery dates instead of actual dates.

## Root Cause
The `settlement_load_items` table has `pickup_date` and `delivery_date` columns that may be null if:
1. Loads were added before the backfill logic was implemented
2. The load itself doesn't have dates in the `loads` table
3. The `addLoadToSettlement` function failed to populate dates from `load_stops`

## Solution

### 1. Backend Query Enhancement
Modified the GET `/settlements/:id` endpoint to use COALESCE fallback:

**File:** `backend/packages/goodmen-shared/routes/settlements.js`

**Change:**
```javascript
// Before (only settlement_load_items dates)
.select('sli.*', 'l.load_number')

// After (with fallback to loads table)
.select(
  'sli.id',
  'sli.settlement_id',
  'sli.load_id',
  knex.raw('COALESCE(sli.pickup_date, l.pickup_date) as pickup_date'),
  knex.raw('COALESCE(sli.delivery_date, l.delivery_date) as delivery_date'),
  'sli.loaded_miles',
  'sli.pay_basis_snapshot',
  'sli.gross_amount',
  'sli.driver_pay_amount',
  'sli.additional_payee_amount',
  'sli.included_by',
  'sli.created_at',
  'sli.updated_at',
  'l.load_number'
)
```

This ensures that if `settlement_load_items` dates are null, it falls back to the dates from the `loads` table.

### 2. Backfill Script
Created a utility script to populate missing dates in existing settlement load items:

**File:** `backend/scripts/backfill-settlement-load-dates.js`

**Features:**
- Finds all settlement_load_items with null pickup_date or delivery_date
- Queries load_stops to get accurate stop dates
- Falls back to loads table dates if stops aren't available
- Updates settlement_load_items with the correct dates
- Provides detailed progress logging

**Usage:**
```bash
cd backend
node scripts/backfill-settlement-load-dates.js
```

**Expected Output:**
```
Starting backfill of settlement load dates...
Found 10 load items with missing dates
✓ Updated load item abc-123 (load xyz-789): pickup=2026-03-01, delivery=2026-03-03
...
=== Backfill Complete ===
✅ Updated: 10
❌ Errors: 0
📊 Total processed: 10
✨ Backfill script completed
```

## How Dates Are Populated

### When Adding New Loads to Settlements
The `addLoadToSettlement` function in `settlement-service.js` already populates dates correctly:

1. Queries `load_stops` table for pickup and delivery stop dates
2. Falls back to `loads.pickup_date` and `loads.delivery_date`
3. Inserts into `settlement_load_items` with these dates

### Priority Order for Date Resolution
1. **Primary:** `settlement_load_items.pickup_date` / `delivery_date` (cached at settlement creation)
2. **Fallback 1:** `loads.pickup_date` / `delivery_date` (via COALESCE in query)
3. **Fallback 2:** Load stops query (used by backfill script)

## Data Flow

```
User adds load to settlement
    ↓
addLoadToSettlement() queries load_stops
    ↓
Finds first PICKUP stop and last DELIVERY stop
    ↓
Inserts into settlement_load_items with dates
    ↓
Frontend fetches settlement
    ↓
Backend returns load_items with COALESCE dates
    ↓
Frontend displays dates in table
```

## Testing

### 1. Check Existing Data
```sql
-- Find settlement load items without dates
SELECT 
  sli.id,
  sli.settlement_id,
  sli.load_id,
  sli.pickup_date as sli_pickup,
  sli.delivery_date as sli_delivery,
  l.pickup_date as load_pickup,
  l.delivery_date as load_delivery
FROM settlement_load_items sli
LEFT JOIN loads l ON l.id = sli.load_id
WHERE sli.pickup_date IS NULL OR sli.delivery_date IS NULL;
```

### 2. Run Backfill
```bash
node backend/scripts/backfill-settlement-load-dates.js
```

### 3. Verify in UI
1. Open any settlement detail page
2. Check Load Earnings table
3. Verify pickup and delivery dates are displayed (not "—")

### 4. Test New Load Addition
1. Create a new settlement or open existing draft
2. Add a load
3. Verify pickup and delivery dates appear immediately

## Related Files

**Backend:**
- `backend/packages/goodmen-shared/routes/settlements.js` (query fix)
- `backend/packages/goodmen-shared/services/settlement-service.js` (addLoadToSettlement)
- `backend/scripts/backfill-settlement-load-dates.js` (utility script)

**Frontend:**
- `frontend/src/app/settlements/settlement-detail/settlement-detail.component.ts`
- `frontend/src/app/settlements/settlement-detail/settlement-detail.component.html`

**Database:**
- `settlement_load_items` table (has pickup_date, delivery_date columns)
- `loads` table (has pickup_date, delivery_date columns)
- `load_stops` table (has stop_type, stop_date columns)

## Deployment Steps

1. Deploy backend code with the query fix
2. Run backfill script to update existing data:
   ```bash
   cd backend
   node scripts/backfill-settlement-load-dates.js
   ```
3. Verify in UI that dates now display correctly
4. Monitor for any remaining issues

## Future Improvements

1. **Real-time Sync:** Add a database trigger to auto-update settlement_load_items dates when loads table dates change
2. **Validation:** Add constraint to ensure dates are always populated when inserting settlement load items
3. **Admin Tool:** Create UI button to trigger backfill for individual settlements
4. **Audit Log:** Track when dates were backfilled or updated

## Troubleshooting

**Q: Dates still showing "—" after fix**
A: Run the backfill script to populate historical data

**Q: New loads added still don't have dates**
A: Check that the load itself has dates in the loads table and load_stops table

**Q: Backfill script fails**
A: Check that you have database connection and the load_stops table exists

**Q: Dates are wrong/inconsistent**
A: Check load_stops table for the specific load - ensure stop_type and stop_date are correct

---

**Fix Date:** March 8, 2026  
**Issue:** Load earnings pickup/delivery dates not displaying  
**Status:** ✅ Resolved
