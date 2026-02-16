# Phase 2: Test Credentials & Data Reference

## Test User Roles

When testing APIs locally, use the `x-user-role` header with one of these values:

```bash
# Admin - Full access to all endpoints
-H "x-user-role: admin"

# Parts Manager - Create/edit parts, manage receiving/adjustments
-H "x-user-role: parts_manager"

# Shop Manager - View inventory, create adjustments, manage cycle counts
-H "x-user-role: shop_manager"

# Technician - Read-only access to inventory/parts (no write permissions)
-H "x-user-role: technician"
```

## Location IDs (Seeded)

All inventory operations require a `locationId`. Use these IDs from the seed data:

```
Location A (New York):        aaaa0000-0000-0000-0000-000000000001
Location B (Los Angeles):     aaaa0000-0000-0000-0000-000000000002
Location C (Chicago):         aaaa0000-0000-0000-0000-000000000003
```

## Part IDs (Sample Parts Seeded)

Use these IDs when testing receiving, adjustments, cycle counts:

```
Filters Category (3 parts):
  AIR-FILTER-01:   bbbb0000-0000-0000-0000-000000000001
  OIL-FILTER-01:   bbbb0000-0000-0000-0000-000000000002
  CABIN-FILTER-01: bbbb0000-0000-0000-0000-000000000003

Tires Category (2 parts):
  TIRE-RADIAL-11:  bbbb0000-0000-0000-0000-000000000004
  TIRE-TRAILER-01: bbbb0000-0000-0000-0000-000000000005

Fluids Category (3 parts):
  ENGINE-OIL-5L:   bbbb0000-0000-0000-0000-000000000006
  COOLANT-5L:      bbbb0000-0000-0000-0000-000000000007
  TRANSMISSION-4L: bbbb0000-0000-0000-0000-000000000008

Brakes Category (2 parts):
  BRAKE-PAD-SET:   bbbb0000-0000-0000-0000-000000000009
  BRAKE-ROTOR-18:  bbbb0000-0000-0000-0000-000000000010

Batteries Category (1 part):
  BATTERY-12V:     bbbb0000-0000-0000-0000-000000000011

Lights/Electronics (2 parts):
  HEADLIGHT-LED:   bbbb0000-0000-0000-0000-000000000012
  ALTERNATOR-160A: bbbb0000-0000-0000-0000-000000000013

Belts/Hoses (2 parts):
  SERPENTINE-BELT: bbbb0000-0000-0000-0000-000000000014
  RADIATOR-HOSE:   bbbb0000-0000-0000-0000-000000000015
```

## Sample API Calls

### 1. Get All Parts (Public - Any Role)
```bash
curl http://localhost:3000/api/parts \
  -H "x-user-role: admin" | jq .
```

### 2. Get Parts by Category
```bash
curl "http://localhost:3000/api/parts?category=Filters" \
  -H "x-user-role: admin" | jq .
```

### 3. Create a New Part (Admin/Parts Manager Only)
```bash
curl -X POST http://localhost:3000/api/parts \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{
    "sku": "CUSTOM-001",
    "name": "Custom Part",
    "category": "Custom",
    "manufacturer": "Test Mfg",
    "uom": "each",
    "default_cost": 45.00,
    "default_retail_price": 89.99
  }' | jq .
```

### 4. Get Inventory for Location A
```bash
curl "http://localhost:3000/api/inventory?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 5. Get Low Stock Alerts
```bash
curl "http://localhost:3000/api/inventory/alerts?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 6. Create Receiving Ticket
```bash
curl -X POST http://localhost:3000/api/receiving \
  -H "Content-Type: application/json" \
  -H "x-user-role: parts_manager" \
  -d '{
    "locationId": "aaaa0000-0000-0000-0000-000000000001",
    "vendorName": "Truck Parts Inc",
    "referenceNumber": "PO-2025-001"
  }' | jq .
```

### 7. Add Line to Receiving Ticket
```bash
# After creating ticket, get the ticket ID from response (e.g., TICKET_ID)
curl -X POST http://localhost:3000/api/receiving/{TICKET_ID}/lines \
  -H "Content-Type: application/json" \
  -H "x-user-role: parts_manager" \
  -d '{
    "partId": "bbbb0000-0000-0000-0000-000000000001",
    "qtyReceived": 100,
    "unitCost": 15.50,
    "binLocationOverride": "A-101"
  }' | jq .
```

### 8. Post (Finalize) Receiving Ticket
```bash
curl -X POST http://localhost:3000/api/receiving/{TICKET_ID}/post \
  -H "Content-Type: application/json" \
  -H "x-user-role: parts_manager" \
  -d '{}' | jq .
```

### 9. Create Adjustment
```bash
curl -X POST http://localhost:3000/api/adjustments \
  -H "Content-Type: application/json" \
  -H "x-user-role: parts_manager" \
  -d '{
    "locationId": "aaaa0000-0000-0000-0000-000000000001",
    "partId": "bbbb0000-0000-0000-0000-000000000001",
    "adjustmentType": "DELTA",
    "deltaQty": -5,
    "reasonCode": "DAMAGED",
    "notes": "Damaged during inspection"
  }' | jq .
```

### 10. Post (Finalize) Adjustment
```bash
curl -X POST http://localhost:3000/api/adjustments/{ADJ_ID}/post \
  -H "Content-Type: application/json" \
  -H "x-user-role: parts_manager" \
  -d '{}' | jq .
```

### 11. Create Cycle Count
```bash
curl -X POST http://localhost:3000/api/cycle-counts \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{
    "locationId": "aaaa0000-0000-0000-0000-000000000001",
    "method": "CATEGORY",
    "filterValue": "Filters"
  }' | jq .
```

### 12. Get Cycle Count Details
```bash
curl http://localhost:3000/api/cycle-counts/{CYCLE_ID} \
  -H "x-user-role: admin" | jq .
```

### 13. Update Cycle Count Line
```bash
# After getting cycle count details, use a line ID from the response
curl -X PUT http://localhost:3000/api/cycle-counts/{CYCLE_ID}/lines/{LINE_ID} \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{
    "countedQty": 45,
    "notes": "Physical count complete"
  }' | jq .
```

### 14. Submit Cycle Count
```bash
curl -X POST http://localhost:3000/api/cycle-counts/{CYCLE_ID}/submit \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{}' | jq .
```

### 15. Approve Cycle Count (Posts Variance)
```bash
curl -X POST http://localhost:3000/api/cycle-counts/{CYCLE_ID}/approve \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{}' | jq .
```

### 16. Get Inventory Status Report
```bash
curl "http://localhost:3000/api/reports/inventory-status?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 17. Get Low Stock Report
```bash
curl "http://localhost:3000/api/reports/low-stock?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 18. Get Valuation Report
```bash
curl "http://localhost:3000/api/reports/valuation?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 19. Get Movement Report (Last 30 Days)
```bash
curl "http://localhost:3000/api/reports/movement?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### 20. Get Cycle Variance Report
```bash
curl "http://localhost:3000/api/reports/cycle-variance?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

## Permission Tests

### Test: Technician Cannot Create Parts
```bash
# Should return 403 Forbidden
curl -X POST http://localhost:3000/api/parts \
  -H "Content-Type: application/json" \
  -H "x-user-role: technician" \
  -d '{"sku":"TEST","name":"Test"}'
```

### Test: Shop Manager Cannot Post Receiving
```bash
# Should return 403 Forbidden
curl -X POST http://localhost:3000/api/receiving/{TICKET_ID}/post \
  -H "x-user-role: shop_manager" \
  -d '{}'
```

### Test: Technician Can View Inventory
```bash
# Should succeed (200 OK)
curl "http://localhost:3000/api/inventory?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: technician"
```

## Using the Test Script

Run all 26 tests at once:

```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend
chmod +x test-inventory-api.sh
./test-inventory-api.sh
```

This generates formatted output with full JSON responses for inspection.

## API Response Format

All successful responses follow this pattern:
```json
{
  "success": true,
  "data": { /* endpoint-specific data */ },
  "message": "Success message"
}
```

Errors follow this pattern:
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details if available"
}
```

## Quick Notes

- **Default Headers**: Always include `x-user-role` header (even for public endpoints)
- **Location Filtering**: Most inventory operations require `locationId` query param
- **Status Transitions**: 
  - Receiving: DRAFT → POSTED (one-way)
  - Adjustments: DRAFT → POSTED (one-way)
  - Cycle Counts: DRAFT → SUBMITTED → APPROVED (sequential)
- **Immutable Logs**: `inventory_transactions` table is append-only (no deletes/updates)
- **Audit Trail**: Every operation creates a transaction record with user_id, created_at, reference info

## Next Steps

1. **Create remaining Angular components** (5 more components)
2. **Add tests** (unit + integration test suites)
3. **Deploy to staging** (configure environment for production)
4. **Enable rate limiting** on production APIs
