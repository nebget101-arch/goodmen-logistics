# Vehicle Field Update: last_inspection_date → inspection_expiry

## Summary
Changed the vehicle field from `last_inspection_date` to `inspection_expiry` to better reflect its purpose (storing when inspection expires, not when it was last performed). Also added a vehicle details modal for viewing full vehicle information.

## Changes Made

### 1. Database Schema
**File:** `backend/database/schema.sql`
- ✅ Changed column name: `last_inspection_date DATE` → `inspection_expiry DATE`

### 2. Backend API
**File:** `backend/routes/vehicles.js`
- ✅ Updated POST endpoint to use `inspection_expiry` field
- ✅ Previously updated PUT endpoint to exclude read-only fields

### 3. Frontend Interface
**File:** `frontend/src/app/components/vehicles/vehicles.component.ts`
- ✅ Updated `Vehicle` interface: removed `last_inspection_date`, confirmed `inspection_expiry`
- ✅ Updated `SortField` type: `'unit_number' | 'inspection_expiry'`
- ✅ Updated sort logic to use `inspection_expiry`
- ✅ Updated `getExpiryWarning()` to check `inspection_expiry` directly
- ✅ Updated `isVehicleExpired()` to use `inspection_expiry`
- ✅ Added detail view state: `selectedVehicleDetails`, `showVehicleDetails`
- ✅ Added methods: `openVehicleDetails()`, `closeVehicleDetails()`

### 4. Vehicle List Template
**File:** `frontend/src/app/components/vehicles/vehicles.component.html`
- ✅ Updated table header: "Last Inspection" → "Inspection Expires"
- ✅ Updated sort handlers to use `inspection_expiry`
- ✅ Updated column display to show `inspection_expiry | date`
- ✅ Added row click handler: `(click)="openVehicleDetails(vehicle)"`
- ✅ Added complete vehicle details modal with three sections:
  - Basic Information (Unit #, VIN, Make, Model, Year, etc.)
  - Status & Compliance (Status, Mileage, Inspection, Insurance, Registration)
  - Maintenance (Next PM Due, Next PM Mileage, OOS Reason if applicable)

### 5. Vehicle Form Component
**File:** `frontend/src/app/components/vehicles/vehicle-form/vehicle-form.component.ts`
- ✅ Updated `VehicleFormData` interface to use `inspection_expiry`
- ✅ Updated initial form data
- ✅ Updated `loadFormData()` reset logic
- ✅ Updated `getInspectionStatus()` to use `inspection_expiry`

### 6. Vehicle Form Template
**File:** `frontend/src/app/components/vehicles/vehicle-form/vehicle-form.component.html`
- ✅ Updated label: "Last Inspection Date" → "Inspection Expiration Date"
- ✅ Updated input field ID and model binding to `inspection_expiry`

### 7. Seed Data
**File:** `backend/database/seed.sql`
- ✅ Updated INSERT statement to use `inspection_expiry` column

### 8. Styles
**File:** `frontend/src/app/components/vehicles/vehicles.component.css`
- ✅ Added complete modal styles with animations
- ✅ Added `.modal-overlay` with backdrop blur
- ✅ Added `.vehicle-details-modal` with slide-in animation
- ✅ Added `.details-grid` with 2-column responsive layout
- ✅ Added `.detail-section` with color-coded left border
- ✅ Added `.detail-row`, `.detail-label`, `.detail-value` styles
- ✅ Added utility classes: `.text-danger`, `.text-warning`, `.text-success`
- ✅ Added responsive breakpoints for mobile

## Migration

### Database Migration Script
**File:** `backend/database/migrate-inspection-field.sql`

To apply this migration to existing databases:

```bash
# Local database
psql -U postgres -d safetyapp -f backend/database/migrate-inspection-field.sql

# Production (Render)
# Connect via Render dashboard SQL editor and run the migration script
```

The migration script:
- Checks if `last_inspection_date` column exists
- Renames it to `inspection_expiry`
- Provides success/skip messages
- Safe to run multiple times (idempotent)

## Testing Checklist

- [ ] Verify frontend compiles without errors
- [ ] Verify backend starts without errors
- [ ] Test vehicle list loads and displays inspection expiry dates
- [ ] Test sorting by "Inspection Expires" column
- [ ] Test adding a new vehicle with inspection expiry date
- [ ] Test editing an existing vehicle's inspection expiry
- [ ] Test expiry warnings (yellow for 60 days, red for expired)
- [ ] Test automatic OOS for expired inspections
- [ ] Test clicking a vehicle row opens details modal
- [ ] Test details modal displays all vehicle information correctly
- [ ] Test "Edit Vehicle" button in details modal
- [ ] Test close button and overlay click closes modal
- [ ] Run database migration on local database
- [ ] Verify seed data creates vehicles with inspection_expiry
- [ ] Test responsive design for details modal on mobile

## Benefits of This Change

1. **Clearer Semantics**: Field name now matches what it stores (expiry date, not last inspection date)
2. **Simplified Logic**: No need to calculate "1 year from last inspection" - just check the expiry date directly
3. **Better UX**: Users immediately understand when inspection expires
4. **Better Data Quality**: Encourages storing the actual expiry date from inspection documents
5. **Enhanced Visibility**: Details modal provides comprehensive view without editing

## Rollback Plan

If needed, the migration can be reversed:

```sql
ALTER TABLE vehicles 
RENAME COLUMN inspection_expiry TO last_inspection_date;
```

Then revert all code changes using git:
```bash
git checkout HEAD -- backend/database/schema.sql
git checkout HEAD -- backend/routes/vehicles.js
git checkout HEAD -- frontend/src/app/components/vehicles/
```
