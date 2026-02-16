# Phase 2: Quick Reference Card

## 🚀 Get Started in 3 Steps

```bash
# Step 1: Start Backend
cd goodmen-logistics/backend && node server.js

# Step 2: Start Frontend (new terminal)
cd goodmen-logistics/frontend && npm start

# Step 3: Test APIs (new terminal)
cd goodmen-logistics/backend && chmod +x test-inventory-api.sh && ./test-inventory-api.sh
```

**Access**: http://localhost:4200

---

## 📚 Documentation Map

| Need | Document | Time |
|------|----------|------|
| 👀 Quick Overview | [PHASE_2_DELIVERY_CHECKLIST.md](./PHASE_2_DELIVERY_CHECKLIST.md) | 5 min |
| 🔧 How to Build Components | [PHASE_2_DEVELOPER_GUIDE.md](./PHASE_2_DEVELOPER_GUIDE.md) | 10 min |
| 🧪 Test the APIs | [PHASE_2_TEST_CREDENTIALS.md](./PHASE_2_TEST_CREDENTIALS.md) | 5 min |
| 📋 Complete Tech Spec | [PHASE_2_INVENTORY_SUMMARY.md](./PHASE_2_INVENTORY_SUMMARY.md) | 20 min |
| 🗺️ Documentation Index | [PHASE_2_INDEX.md](./PHASE_2_INDEX.md) | 5 min |

---

## 🎯 What's Done ✅

### Backend (100%)
- ✅ Database: 8 tables with 3 locations + 15 parts + 45 inventory records
- ✅ Services: inventory.service, parts.service
- ✅ APIs: 35+ endpoints across 7 route files
- ✅ Auth: JWT + RBAC with 4 roles
- ✅ Workflows: Receiving, Adjustments, Cycle Counts

### Frontend (50%)
- ✅ API Service: 50+ methods
- ✅ Parts Catalog: Full CRUD component
- 🟡 6 Additional Components: Scaffolding + specs ready

### Documentation (100%)
- ✅ Architecture documentation
- ✅ API reference with examples
- ✅ Database schema
- ✅ Test credentials
- ✅ Developer guide

---

## 🧪 Test APIs Quickly

### Option 1: Automated Test Suite (26 Tests)
```bash
cd goodmen-logistics/backend
./test-inventory-api.sh
```

### Option 2: Single API Call
```bash
# Get all parts
curl http://localhost:3000/api/parts \
  -H "x-user-role: admin" | jq .

# Get inventory alerts
curl "http://localhost:3000/api/inventory/alerts?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .
```

### Option 3: Frontend
- Navigate to http://localhost:4200
- Click "Parts" menu → "Catalog"
- Create/Edit/View parts

---

## 👥 Test User Roles

Use these headers when testing APIs locally:

```bash
-H "x-user-role: admin"              # Full access
-H "x-user-role: parts_manager"      # Create parts, receiving
-H "x-user-role: shop_manager"       # View inventory, create adjustments
-H "x-user-role: technician"         # Read-only access
```

---

## 🏢 Test Locations & Parts

### Locations
```
Location A (New York):        aaaa0000-0000-0000-0000-000000000001
Location B (Los Angeles):     aaaa0000-0000-0000-0000-000000000002
Location C (Chicago):         aaaa0000-0000-0000-0000-000000000003
```

### Sample Parts (by category)
```
Filters:        AIR-FILTER-01, OIL-FILTER-01, CABIN-FILTER-01
Tires:          TIRE-RADIAL-11, TIRE-TRAILER-01
Fluids:         ENGINE-OIL-5L, COOLANT-5L, TRANSMISSION-4L
Brakes:         BRAKE-PAD-SET, BRAKE-ROTOR-18
Batteries:      BATTERY-12V
Electronics:    HEADLIGHT-LED, ALTERNATOR-160A
Belts/Hoses:    SERPENTINE-BELT, RADIATOR-HOSE
```

---

## 📊 Key Endpoints

### Parts (7 endpoints)
```
GET    /api/parts                    # List all parts
GET    /api/parts/categories         # Get dropdown data
GET    /api/parts/manufacturers      # Get dropdown data
GET    /api/parts/:id                # Get single part
POST   /api/parts                    # Create part (admin/parts_manager)
PUT    /api/parts/:id                # Update part (admin/parts_manager)
PATCH  /api/parts/:id/deactivate     # Deactivate part (admin/parts_manager)
```

### Inventory (4 endpoints)
```
GET    /api/inventory                # Get inventory by location
GET    /api/inventory/alerts         # Get low/out of stock items
GET    /api/inventory/status/:id     # Get status summary
PUT    /api/inventory/:id            # Update min_stock/bin_location
```

### Receiving (6 endpoints)
```
GET    /api/receiving                # List receiving tickets
GET    /api/receiving/:id            # Get ticket details
POST   /api/receiving                # Create ticket (admin/parts_manager)
POST   /api/receiving/:id/lines      # Add receiving line
DELETE /api/receiving/:id/lines/:lid # Remove line
POST   /api/receiving/:id/post       # Finalize ticket
```

### Adjustments (5 endpoints)
```
GET    /api/adjustments              # List adjustments
GET    /api/adjustments/:id          # Get adjustment
POST   /api/adjustments              # Create adjustment (admin/parts_manager/shop_manager)
PUT    /api/adjustments/:id          # Update adjustment
POST   /api/adjustments/:id/post     # Finalize adjustment
```

### Cycle Counts (6 endpoints)
```
GET    /api/cycle-counts             # List counts
GET    /api/cycle-counts/:id         # Get count detail
POST   /api/cycle-counts             # Create count (admin/parts_manager/shop_manager)
PUT    /api/cycle-counts/:id/lines/:lid  # Enter physical count
POST   /api/cycle-counts/:id/submit  # Submit count
POST   /api/cycle-counts/:id/approve # Approve & post variance (admin/parts_manager)
```

### Reports (5 endpoints)
```
GET    /api/reports/inventory-status      # Inventory status report
GET    /api/reports/low-stock             # Low stock report
GET    /api/reports/valuation             # Total inventory value
GET    /api/reports/movement              # Transaction history
GET    /api/reports/cycle-variance        # Variance report
```

---

## 🔄 Workflow Examples

### Receiving Flow
```
1. Create ticket:
   POST /api/receiving 
   {locationId, vendorName, referenceNumber}

2. Add line(s):
   POST /api/receiving/{id}/lines
   {partId, qtyReceived, unitCost}

3. Finalize:
   POST /api/receiving/{id}/post
   → Creates RECEIVE transaction
   → Updates on_hand_qty
```

### Adjustment Flow
```
1. Create adjustment:
   POST /api/adjustments
   {locationId, partId, adjustmentType, deltaQty or setToQty, reasonCode}

2. Post adjustment:
   POST /api/adjustments/{id}/post
   → Creates ADJUST transaction
   → Updates on_hand_qty
   → Records variance
```

### Cycle Count Flow
```
1. Create count:
   POST /api/cycle-counts
   {locationId, method: "CATEGORY"|"BIN_RANGE"|"SELECTED_PARTS", filterValue}

2. Enter counts:
   PUT /api/cycle-counts/{id}/lines/{lineId}
   {countedQty, notes}

3. Submit:
   POST /api/cycle-counts/{id}/submit

4. Approve (posts variance):
   POST /api/cycle-counts/{id}/approve
   → For each line with variance:
      - Creates variance transaction
      - Updates on_hand_qty to counted_qty
```

---

## 🔐 Important Notes

1. **All endpoints** require `x-user-role` header
2. **Inventory operations** require `locationId` query/path param
3. **Write operations** check user role in requireRole middleware
4. **Transactions** are immutable (append-only audit log)
5. **Negative inventory** is blocked unless admin with override
6. **Parts** are soft-deleted (is_active flag)
7. **Status enums**: DRAFT, POSTED, SUBMITTED, APPROVED

---

## 📝 Response Format

**Success**:
```json
{
  "success": true,
  "data": {...},
  "message": "Operation successful"
}
```

**Error**:
```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details"
}
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 3000 in use | `lsof -i :3000` then kill the process |
| Module not found | `npm install` in that directory |
| API returning 403 | Check `x-user-role` header or user permissions |
| Data not showing | Verify locationId is correct |
| Receiving won't post | Check all lines have qtyReceived > 0 |
| Component not showing | Verify it's added to app.module.ts declarations |

---

## 📞 Quick Help

**API not responding?**
```bash
curl http://localhost:3000/api/health
```

**Check if migrations ran?**
```bash
cd backend && npm run knex migrate:status
```

**Seed data again?**
```bash
cd backend && npm run knex seed:run
```

**Check server logs?**
Look at terminal where you ran `node server.js`

---

## ⏱️ Effort Estimates

| Task | Time |
|------|------|
| Run existing system | 5 min |
| Test all APIs | 10 min |
| Build 1 component | 1-1.5 hours |
| Write unit tests | 2-3 hours |
| Full integration tests | 3-4 hours |
| Complete Phase 2 | 15-20 hours |

---

## 🎯 Next Priority Actions

1. **Build 6 components** (follow [PHASE_2_DEVELOPER_GUIDE.md](./PHASE_2_DEVELOPER_GUIDE.md))
2. **Write tests** (unit + integration)
3. **Deploy to staging**
4. **Performance optimize** (if needed)
5. **Production hardening**

---

## 📱 Access Points

| Component | URL | Status |
|-----------|-----|--------|
| Frontend | http://localhost:4200 | ✅ Running |
| Backend API | http://localhost:3000/api | ✅ Running |
| Parts Catalog | http://localhost:4200/parts | ✅ Complete |
| Inventory Dashboard | http://localhost:4200/inventory/dashboard | 🟡 Build needed |
| Receive Stock | http://localhost:4200/inventory/receive | 🟡 Build needed |
| Reports | http://localhost:4200/inventory/reports | 🟡 Build needed |

---

## 💾 Key Files

```
Database:      backend/migrations/20260216_create_inventory_schema.js
Seed Data:     backend/seeds/02_inventory_seed.js
Services:      backend/services/*.js
APIs:          backend/routes/*.js
Auth:          backend/middleware/auth-middleware.js
API Methods:   frontend/src/app/services/api.service.ts
Components:    frontend/src/app/components/*/
```

---

**Phase 2 Status**: ✅ Backend Complete | 🟡 Frontend 50% | ✅ Documented
**Last Updated**: Phase 2 Delivery Complete
**Next**: Frontend Components & Testing

🚀 Ready to go!
