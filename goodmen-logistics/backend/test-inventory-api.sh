#!/bin/bash

# Phase 2 Inventory Management - Quick API Testing Guide
# Run these commands to test the inventory endpoints

BASE_URL="http://localhost:3000/api"
ADMIN_ROLE="admin"
PARTS_MANAGER_ROLE="parts_manager"
SHOP_MANAGER_ROLE="shop_manager"
TECHNICIAN_ROLE="technician"

# =============================================
# PARTS CATALOG ENDPOINTS
# =============================================

echo "=== Testing Parts Catalog ==="

# 1. Get all active parts
echo "1. GET all parts"
curl -s -X GET "$BASE_URL/parts" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 2. Get distinct categories
echo "2. GET categories"
curl -s -X GET "$BASE_URL/parts/categories" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 3. Get distinct manufacturers
echo "3. GET manufacturers"
curl -s -X GET "$BASE_URL/parts/manufacturers" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 4. Create a new part
echo "4. POST create part"
curl -s -X POST "$BASE_URL/parts" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d '{
    "sku": "TEST-001",
    "name": "Test Part",
    "category": "Test Category",
    "manufacturer": "Test Manufacturer",
    "uom": "each",
    "default_cost": 50.00,
    "default_retail_price": 99.99,
    "reorder_point_default": 5,
    "reorder_qty_default": 20
  }' | jq .

# 5. Get parts with filters
echo "5. GET parts with filter (category=Filters)"
curl -s -X GET "$BASE_URL/parts?category=Filters" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 6. Search parts by SKU
echo "6. GET parts with search"
curl -s -X GET "$BASE_URL/parts?search=OIL" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# =============================================
# INVENTORY ENDPOINTS
# =============================================

echo "=== Testing Inventory ==="

# Get location ID from database (assuming first location is: aaaa0000-0000-0000-0000-000000000001)
LOCATION_ID="aaaa0000-0000-0000-0000-000000000001"

# 1. Get inventory for location
echo "7. GET inventory for location"
curl -s -X GET "$BASE_URL/inventory?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 2. Get alerts
echo "8. GET alerts for location"
curl -s -X GET "$BASE_URL/inventory/alerts?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 3. Get inventory status
echo "9. GET inventory status"
curl -s -X GET "$BASE_URL/inventory/status/$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# =============================================
# RECEIVING WORKFLOW
# =============================================

echo "=== Testing Receiving Workflow ==="

# 1. Create receiving ticket
echo "10. POST create receiving ticket"
TICKET_RESPONSE=$(curl -s -X POST "$BASE_URL/receiving" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d "{
    \"locationId\": \"$LOCATION_ID\",
    \"vendorName\": \"Test Vendor\",
    \"referenceNumber\": \"PO-12345\"
  }")

echo "$TICKET_RESPONSE" | jq .
TICKET_ID=$(echo "$TICKET_RESPONSE" | jq -r '.data.id')

echo "Created ticket ID: $TICKET_ID"

# 2. Get part ID from database (assuming first part is filter-oil-01)
PART_ID="bbbb0000-0000-0000-0000-000000000001"

# 3. Add line to ticket
echo "11. POST add line to receiving ticket"
curl -s -X POST "$BASE_URL/receiving/$TICKET_ID/lines" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d "{
    \"partId\": \"$PART_ID\",
    \"qtyReceived\": 100,
    \"unitCost\": 15.50,
    \"binLocationOverride\": \"A-101\"
  }" | jq .

# 4. Get receiving tickets
echo "12. GET receiving tickets"
curl -s -X GET "$BASE_URL/receiving?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 5. Post (finalize) ticket
echo "13. POST finalize receiving ticket"
curl -s -X POST "$BASE_URL/receiving/$TICKET_ID/post" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d '{}' | jq .

# =============================================
# ADJUSTMENT WORKFLOW
# =============================================

echo "=== Testing Adjustment Workflow ==="

# 1. Create adjustment
echo "14. POST create adjustment (DELTA)"
ADJ_RESPONSE=$(curl -s -X POST "$BASE_URL/adjustments" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $PARTS_MANAGER_ROLE" \
  -d "{
    \"locationId\": \"$LOCATION_ID\",
    \"partId\": \"$PART_ID\",
    \"adjustmentType\": \"DELTA\",
    \"deltaQty\": -5,
    \"reasonCode\": \"DAMAGED\",
    \"notes\": \"Damaged in handling\"
  }")

echo "$ADJ_RESPONSE" | jq .
ADJ_ID=$(echo "$ADJ_RESPONSE" | jq -r '.data.id')

echo "Created adjustment ID: $ADJ_ID"

# 2. Get adjustments
echo "15. GET adjustments"
curl -s -X GET "$BASE_URL/adjustments?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 3. Post adjustment
echo "16. POST finalize adjustment"
curl -s -X POST "$BASE_URL/adjustments/$ADJ_ID/post" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d '{}' | jq .

# =============================================
# CYCLE COUNT WORKFLOW
# =============================================

echo "=== Testing Cycle Count Workflow ==="

# 1. Create cycle count
echo "17. POST create cycle count (CATEGORY method)"
CYCLE_RESPONSE=$(curl -s -X POST "$BASE_URL/cycle-counts" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" \
  -d "{
    \"locationId\": \"$LOCATION_ID\",
    \"method\": \"CATEGORY\",
    \"filterValue\": \"Filters\"
  }")

echo "$CYCLE_RESPONSE" | jq .
CYCLE_ID=$(echo "$CYCLE_RESPONSE" | jq -r '.data.id')

echo "Created cycle count ID: $CYCLE_ID"

# 2. Get cycle count details
echo "18. GET cycle count details"
curl -s -X GET "$BASE_URL/cycle-counts/$CYCLE_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 3. Update line with counted qty (get line ID from previous response)
# This is a manual step - you would get LINE_ID from the cycle count details
echo "19. PUT update cycle count line (example, replace LINE_ID)"
# curl -s -X PUT "$BASE_URL/cycle-counts/$CYCLE_ID/lines/LINE_ID" \
#   -H "Content-Type: application/json" \
#   -H "x-user-role: $ADMIN_ROLE" \
#   -d '{"countedQty": 45, "notes": "Physical count result"}' | jq .

# =============================================
# REPORTS
# =============================================

echo "=== Testing Reports ==="

# 1. Inventory status report
echo "20. GET inventory status report"
curl -s -X GET "$BASE_URL/reports/inventory-status?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 2. Low stock report
echo "21. GET low stock report"
curl -s -X GET "$BASE_URL/reports/low-stock?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 3. Valuation report
echo "22. GET valuation report"
curl -s -X GET "$BASE_URL/reports/valuation?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 4. Movement report (last 30 days)
echo "23. GET movement report"
curl -s -X GET "$BASE_URL/reports/movement?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# 5. Cycle variance report
echo "24. GET cycle variance report"
curl -s -X GET "$BASE_URL/reports/cycle-variance?locationId=$LOCATION_ID" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $ADMIN_ROLE" | jq .

# =============================================
# PERMISSION TESTS
# =============================================

echo "=== Testing Permissions ==="

# 1. Technician cannot create part (should be blocked)
echo "25. POST create part AS TECHNICIAN (should fail)"
curl -s -X POST "$BASE_URL/parts" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $TECHNICIAN_ROLE" \
  -d '{
    "sku": "BLOCK-001",
    "name": "Blocked Part",
    "category": "Test",
    "manufacturer": "Test"
  }' | jq .

# 2. Technician can view parts (should succeed)
echo "26. GET parts AS TECHNICIAN (should succeed)"
curl -s -X GET "$BASE_URL/parts" \
  -H "Content-Type: application/json" \
  -H "x-user-role: $TECHNICIAN_ROLE" | jq '. | {success, count: (.data | length)}'

echo "=== Testing Complete ==="
