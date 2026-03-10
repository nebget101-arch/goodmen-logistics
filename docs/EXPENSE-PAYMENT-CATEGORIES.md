# Expense and Payment Categories

This feature provides a comprehensive expense and payment categorization system integrated with the settlement/payroll module.

## Overview

The system includes:
- **Predefined categories**: 37 expense categories and 3 revenue categories
- **Custom categories**: Users can create custom categories for specific needs
- **Hierarchical structure**: Support for parent-child category relationships
- **Settlement integration**: Categories can be assigned to settlement adjustment items
- **API endpoints**: Full CRUD operations for category management

## Database Schema

### Table: `expense_payment_categories`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| code | INTEGER | Unique code (predefined: 1-100, 1000-2000; custom: 2000+) |
| parent_code | INTEGER | Optional parent category code for sub-categories |
| persistent | BOOLEAN | System-defined categories (cannot be deleted) |
| name | TEXT | Category name |
| active | BOOLEAN | Is category active? |
| type | ENUM | 'expense' or 'revenue' |
| description | TEXT | Optional description |
| notes | TEXT | Optional notes |
| created_at | TIMESTAMP | Created timestamp |
| updated_at | TIMESTAMP | Last updated timestamp |

### Integration with Settlement System

Two tables have been enhanced with `category_id` foreign key:
- `settlement_adjustment_items` - Manual adjustments, deductions, earnings
- `imported_expense_items` - Imported expenses from PDFs, CSVs, etc.

## Predefined Categories

### Revenue Categories (3)
- **Detention** (code: 3) - Persistent
- **Lumper** (code: 2) - Persistent
- **Other** (code: 98) - Persistent

### Expense Categories (34)
- **2290 Highway tax** (code: 1009)
- **Advance Pay** (code: 1000)
- **Driver payments** (code: 27) - Persistent
- **ELD** (code: 1008)
- **Factoring Fee** (code: 26) - Persistent
- **Fuel** (code: 5) - Persistent
- **IFTA Tax** (code: 10) - Persistent
- **Inspection** (code: 1011)
- **Insurance** (code: 11)
  - **Down payment** (code: 1003) - Sub-account of Insurance
- **Internet** (code: 24)
- **Legal & Professional** (code: 20)
- **Maintenance** (code: 1001)
- **NM, KY, NY, OR, CT miles tax** (code: 29) - Persistent
- **Office Expenses** (code: 17)
- **Office Rent** (code: 12)
- **Other** (code: 100) - Persistent
- **Parking** (code: 18)
- **Permits** (code: 21)
- **Quick Pay fee** (code: 28) - Persistent
- **Rent** (code: 15)
- **Repairs** (code: 13)
- **Software** (code: 16)
- **Supplies** (code: 19)
- **Telephone** (code: 25)
- **Tolls** (code: 14) - Persistent
- **TONU** (code: 1004)
- **Towing** (code: 1005)
- **Trailer Rent** (code: 1006)
- **Travel** (code: 22)
- **Truck Payment** (code: 1010)
- **Truck Registration** (code: 23)
- **Truck Wash** (code: 1002)
- **Zelle Payment** (code: 1007)

> **Note**: Persistent categories are system-defined and cannot be deleted (but can be deactivated).

## API Endpoints

### Base URL
```
/api/expense-payment-categories
```

### Endpoints

#### 1. List All Categories
```
GET /api/expense-payment-categories
```

**Query Parameters**:
- `type` (optional): Filter by 'expense' or 'revenue'
- `active` (optional): Filter by active status (true/false)
- `includeInactive` (optional): Include inactive categories (true/false)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": 5,
      "parent_code": null,
      "persistent": true,
      "name": "Fuel",
      "active": true,
      "type": "expense",
      "description": "",
      "notes": null,
      "children": []
    }
  ],
  "total": 37
}
```

#### 2. Get Single Category
```
GET /api/expense-payment-categories/:id
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "code": 1003,
    "parent_code": 11,
    "name": "Down payment",
    "type": "expense",
    "parent": { ... },
    "children": []
  }
}
```

#### 3. Create Custom Category
```
POST /api/expense-payment-categories
```

**Request Body**:
```json
{
  "name": "Custom Expense Type",
  "type": "expense",
  "description": "Optional description",
  "notes": "Optional notes",
  "parent_code": null
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "code": 2001,
    "name": "Custom Expense Type",
    "type": "expense",
    "active": true,
    "persistent": false
  },
  "message": "Category created successfully"
}
```

#### 4. Update Category
```
PUT /api/expense-payment-categories/:id
```

**Request Body** (all fields optional):
```json
{
  "name": "Updated Name",
  "active": false,
  "description": "Updated description",
  "notes": "Updated notes",
  "parent_code": 11
}
```

**Note**: Persistent system categories cannot have their name or parent_code modified.

**Response**:
```json
{
  "success": true,
  "data": { ... },
  "message": "Category updated successfully"
}
```

#### 5. Delete/Deactivate Category
```
DELETE /api/expense-payment-categories/:id?hardDelete=false
```

**Query Parameters**:
- `hardDelete` (optional): 'true' for permanent deletion (only if not in use)

**Default Behavior**: Soft delete (sets `active = false`)

**Response**:
```json
{
  "success": true,
  "message": "Category deactivated",
  "note": "This category is used in 5 transaction(s)"
}
```

**Restrictions**:
- Cannot delete persistent system categories
- Hard delete fails if category is in use
- Soft delete always succeeds (deactivates category)

#### 6. Get Usage Statistics
```
GET /api/expense-payment-categories/stats/usage
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": 5,
      "name": "Fuel",
      "type": "expense",
      "active": true,
      "settlement_usage": 125,
      "imported_usage": 450,
      "total_usage": 575
    }
  ]
}
```

## Frontend Integration

### Angular Service

```typescript
import { ExpensePaymentCategoriesService } from './services/expense-payment-categories.service';

// Inject in component
constructor(private categoriesService: ExpensePaymentCategoriesService) {}

// Get all expense categories
this.categoriesService.getExpenseCategories().subscribe(categories => {
  this.expenseCategories = categories;
});

// Get categories for dropdown
this.categoriesService.getCategoriesForDropdown('expense').subscribe(options => {
  this.categoryOptions = options; // [{ value: 'uuid', label: 'Fuel', code: 5 }]
});

// Create custom category
this.categoriesService.createCategory({
  name: 'New Expense Type',
  type: 'expense',
  description: 'Custom expense'
}).subscribe(newCategory => {
  console.log('Created:', newCategory);
});
```

### Settlement Detail Integration

The settlement detail form now includes a category dropdown when adding manual adjustments:

1. **Item Type**: Deduction, Earning, Reimbursement, Advance, Correction
2. **Description**: Free text description
3. **Amount**: Dollar amount
4. **Category**: Dropdown filtered by item type (earning/reimbursement → revenue, others → expense)
5. **Apply To**: Primary payee, Additional payee, Settlement

Categories are **optional** but highly recommended for better reporting and expense tracking.

## Migration Steps

### 1. Run Migration
```bash
cd backend/packages/goodmen-database
npm run migrate:latest
```

This will:
- Create `expense_payment_categories` table
- Seed with 37 predefined categories
- Add `category_id` column to `settlement_adjustment_items`
- Add `category_id` column to `imported_expense_items`

### 2. Restart Services
```bash
docker compose restart logistics-service gateway
```

Or if using Docker:
```bash
cd /Users/nebyougetaneh/Desktop/FleetNeuronAPP
docker compose up -d logistics-service gateway
```

### 3. Verify Migration
```bash
# Check if table exists
docker compose exec postgres psql -U goodmen -d goodmen_production -c "\dt expense_payment_categories"

# Count categories
docker compose exec postgres psql -U goodmen -d goodmen_production -c "SELECT type, COUNT(*) FROM expense_payment_categories GROUP BY type;"
```

Expected output:
```
  type   | count 
---------+-------
 expense |    34
 revenue |     3
```

## Usage Examples

### Creating a Custom Category

**Scenario**: Company needs a "Driver Bonus" category.

```bash
curl -X POST http://localhost:4000/api/expense-payment-categories \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Driver Bonus",
    "type": "expense",
    "description": "Performance-based driver bonuses"
  }'
```

### Assigning Category to Settlement Adjustment

When adding a manual adjustment in the settlement detail screen:

1. Select "Earning" as item type
2. Enter "Q1 Safety Bonus" as description
3. Enter amount: 500.00
4. Select "Driver Bonus" from category dropdown
5. Select "Primary payee"
6. Click "Add adjustment"

The backend will store:
```json
{
  "settlement_id": "uuid",
  "item_type": "earning",
  "description": "Q1 Safety Bonus",
  "amount": 500.00,
  "category_id": "uuid-of-driver-bonus",
  "apply_to": "primary_payee"
}
```

### Deactivating an Unused Category

```bash
curl -X DELETE http://localhost:4000/api/expense-payment-categories/CATEGORY_UUID
```

### Getting Category Statistics

```bash
curl http://localhost:4000/api/expense-payment-categories/stats/usage
```

This shows which categories are most used for reporting and cleanup purposes.

## Reporting and Analytics

With categories assigned to adjustments, you can generate reports like:

- **Expense breakdown by category** (Fuel vs Maintenance vs Insurance)
- **Revenue breakdown** (Detention vs Lumper vs Other)
- **Driver-specific category spending** (How much did Driver X spend on Fuel?)
- **Period comparisons** (Did our fuel costs increase this quarter?)

Example SQL query:
```sql
SELECT 
  epc.name AS category,
  epc.type,
  COUNT(sai.id) AS count,
  SUM(sai.amount) AS total_amount
FROM settlement_adjustment_items sai
JOIN expense_payment_categories epc ON sai.category_id = epc.id
WHERE sai.created_at >= '2026-01-01'
GROUP BY epc.name, epc.type
ORDER BY total_amount DESC;
```

## Best Practices

1. **Always assign categories** when creating manual adjustments
2. **Use existing categories** before creating custom ones
3. **Deactivate instead of delete** categories that are no longer needed
4. **Use descriptive names** for custom categories
5. **Review usage statistics** periodically to identify unused categories
6. **Maintain parent-child relationships** for better organization

## Troubleshooting

### Category dropdown not showing
- Ensure services are restarted after migration
- Check browser console for API errors
- Verify database migration completed: `npm run migrate:status`

### Categories not saving
- Check `category_id` column exists in `settlement_adjustment_items`
- Verify foreign key constraint is working
- Check backend logs for errors

### Custom categories not appearing
- Ensure `active = true` when creating
- Check API response for errors
- Verify code generation (should be >= 2000)

## Future Enhancements

- **Bulk import** of custom categories from CSV
- **Category templates** for different business types
- **Automated category assignment** using AI/ML on transaction descriptions
- **Category budgets** and spending limits
- **Multi-level hierarchies** (currently supports 1 level of parent-child)

## Support

For issues or questions:
1. Check backend logs: `docker compose logs logistics-service`
2. Check database: `docker compose exec postgres psql -U goodmen -d goodmen_production`
3. Review migration file: `backend/packages/goodmen-database/migrations/20260309130000_create_expense_payment_categories.js`
4. Review API routes: `backend/packages/goodmen-shared/routes/expense-payment-categories.js`
