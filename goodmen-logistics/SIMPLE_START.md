# 🚀 TO START THE APPLICATION

## Backend (Already Running ✅)
The backend is currently running on http://localhost:3000

**Test it:** Open http://localhost:3000/api/health in your browser

---

## Frontend (Need to Start)

### Option 1: Quick Commands (Copy & Paste)
```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/frontend
npm install
npm start
```

### Option 2: Step by Step

**Step 1:** Open a new terminal window

**Step 2:** Navigate to frontend folder
```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/frontend
```

**Step 3:** Install dependencies (first time only)
```bash
npm install
```
This takes 2-3 minutes.

**Step 4:** Start the development server
```bash
npm start
```

**Step 5:** Open your browser
```
http://localhost:4200
```

---

## 📦 Phase 2: Testing Inventory APIs (New!)

After backend + frontend are running:

### Option 1: Use the Test Script
```bash
cd /Users/nebyougetaneh/Desktop/SafetyApp/goodmen-logistics/backend
chmod +x test-inventory-api.sh
./test-inventory-api.sh
```

This runs 26 test requests covering:
- Parts Catalog (CRUD, filters, dropdowns)
- Inventory (status, alerts, details)
- Receiving Workflow (create → add lines → post)
- Adjustments (create → finalize with variance)
- Cycle Counts (create → update lines → submit)
- Reports (5 report types)
- Permission Tests (RBAC validation)

### Option 2: Manual Testing with cURL
```bash
# Get all parts
curl http://localhost:3000/api/parts \
  -H "x-user-role: admin" | jq .

# Get inventory alerts for location
curl "http://localhost:3000/api/inventory/alerts?locationId=aaaa0000-0000-0000-0000-000000000001" \
  -H "x-user-role: admin" | jq .

# Create receiving ticket
curl -X POST http://localhost:3000/api/receiving \
  -H "Content-Type: application/json" \
  -H "x-user-role: admin" \
  -d '{"locationId":"aaaa0000-0000-0000-0000-000000000001","vendorName":"Test Vendor"}' | jq .
```

### Option 3: Test via Frontend
- **Parts Catalog**: Navigate to Parts > Catalog
  - View, create, edit, deactivate parts
  - Filter by category/manufacturer
  - Search by SKU/name
  
- **Inventory Dashboard**: Navigate to Inventory
  - View current stock levels by location
  - View low stock alerts
  - Check inventory status and values

---

## ✅ You're Done!

Once both are running, you'll have:
- **Backend API** at http://localhost:3000
- **Frontend App** at http://localhost:4200
- **Phase 2 Inventory APIs** fully functional with:
  - Parts Catalog management
  - Multi-location inventory tracking
  - Receiving/Adjustment/Cycle Count workflows
  - Role-based access control
  - Transaction audit logs
  - 5 comprehensive reports

Navigate through all the features:
- Dashboard
- Drivers
- Vehicles
- HOS (Hours of Service)
- Maintenance
- Loads
- Audit

---

## 📚 More Info

For detailed documentation, see:
- `README.md` - Complete documentation
- `START_GUIDE.md` - Detailed startup guide
- `API_TESTING.md` - API testing examples
- `VISUAL_SUMMARY.md` - Visual overview

---

**That's it! Enjoy your Goodmen Logistics app! 🚛**
