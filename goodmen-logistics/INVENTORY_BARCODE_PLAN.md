# Inventory + Barcode System: Current State & Plan

**Date**: February 27, 2026  
**Goal**: Implement barcode scanning, warehouse-to-shop transfers, technician part consumption, and direct customer sales with full audit trail.

---

## STEP 0: REPOSITORY DISCOVERY (COMPLETED)

### Backend Framework & DB Access
- **Framework**: Express.js (Node.js)
- **Database**: PostgreSQL
- **DB Access**: Knex.js (query builder + migration runner)
- **Migration Pattern**: Files in `backend/migrations/` named `20260216_*.js`
- **Seed Strategy**: Files in `backend/seeds/` numbered `01_`, `02_`, etc.

### Existing Tables & Entities

#### Core Inventory Tables (Already Exist ✅)
1. **parts** (UUID pk)
   - sku (unique), name, category, manufacturer, uom, default_cost, default_retail_price, taxable, is_active, hazmat, warranty_days, reorder_point_default, reorder_qty_default, preferred_vendor_name, notes
   - **Missing**: `barcode` field (single barcode per part) — needs extension to **part_barcodes** for multiple barcodes

2. **inventory** (UUID pk)
   - location_id FK, part_id FK, on_hand_qty, reserved_qty, bin_location, min_stock_level, reorder_qty, last_counted_at, last_received_at, last_issued_at
   - Unique constraint: (location_id, part_id)
   - Indexes: location_id, part_id, (location_id, part_id)

3. **inventory_transactions** (UUID pk) — Immutable Audit Log ✅
   - location_id, part_id, transaction_type, qty_change, unit_cost_at_time, reference_type, reference_id, performed_by_user_id, notes, created_at
   - **Good foundation but missing**:
     - reference_type enums for: BARCODE_SCAN, TRANSFER, WORK_ORDER, CUSTOMER_SALE (currently only supports RECEIVING_TICKET, ADJUSTMENT, CYCLE_COUNT)
     - reserved_qty logic (reserved vs on_hand)

#### Related Tables
- **locations** (UUID pk, 3 seeded: Garland, Rockwall, Hutchins)
- **work_orders** (UUID pk)
  - Includes `work_order_part_items` table (work_order_id, part_id, location_id, qty_requested, qty_reserved, qty_issued, unit_price, taxable)
- **customers** (UUID pk)
- **users** (UUID pk, roles: admin, safety, fleet, dispatch, service_advisor, accounting, technician, parts_manager, shop_manager)
- **invoices** (UUID pk, work_order_id FK, customer_id FK, status)
  - **Missing**: Direct customer sales invoices (no work order, just parts + customer)

### Authentication & Authorization
- **Auth**: JWT (token in Authorization header)
- **Roles**: Extracted from JWT payload (`req.user.role`)
- **Middleware**: `authMiddleware(allowedRoles = [])` in `backend/routes/auth-middleware.js`
- **Role Check Pattern**:
  ```js
  router.post('/endpoint', authMiddleware, requireRole(['admin', 'parts_manager']), async (req, res) => {...})
  ```

### Existing Services & Routes

#### Services
1. **parts.service.js**
   - `getParts(filters)`, `getPartById(id)`, `getPartBySku(sku)`, `createPart()`, `updatePart()`, `deactivatePart()`
   - Filters: category, search (SKU/name)

2. **inventory.service.js**
   - `createTransaction(locationId, partId, transactionType, qtyChange, {...})` — **Uses DB transaction + row lock pattern**
   - `getAlerts(locationId, filters)` — Returns low stock + out of stock

3. **work-orders.service.js**
   - Creates invoices from work orders + part items
   - Enriches invoice line items with part names (from PR context)

4. **invoices.service.js**
   - `getInvoiceById()`, `listInvoices()`, `createInvoiceFromWorkOrder()`
   - Line item enrichment (part name fallback to "Part (unknown)")

5. **customers.service.js**
   - Basic CRUD for customers

#### Routes
- `/api/parts` — List, create, update parts (7 endpoints)
- `/api/inventory` — Query inventory by location (3 endpoints)
- `/api/receiving` — Stock-in workflow (6 endpoints)
- `/api/adjustments` — Manual inventory adjustments (5 endpoints)
- `/api/cycle-counts` — Physical count workflow (6 endpoints)
- `/api/reports` — Inventory analytics (5 endpoints)
- `/api/work-orders` — Work order CRUD + invoicing
- `/api/invoices` — Invoice management
- `/api/customers` — Customer CRUD

### API Conventions
- **Response Format**: `{ success: true, data: {...} }` or error
- **Error Handling**: 400 (bad request), 403 (forbidden), 404 (not found), 500 (server error)
- **Auth Pattern**: All routes use `authMiddleware` first, then optional role-based `requireRole()`
- **Logging**: Dynatrace logger via `dtLogger.info()`, `dtLogger.error()`
- **Transactions**: Using `db.transaction()` pattern from Knex

### Frontend Framework
- **Framework**: Angular (TypeScript)
- **Routing**: Angular Router with lazy loading
- **Auth**: JWT stored in `localStorage.token`, roles in `localStorage.role`
- **Sidebar**: Collapsible navigation with sections (Equipment, Safety, Fleet, Inventory, Accounting)
- **UI Components**: Reactive forms, mat-dialog, table-responsive, CSS Grid/Flexbox

---

## STEP 1: DB SCHEMA ADDITIONS & MIGRATIONS

### New Tables Needed

#### 1. **part_barcodes** (for multiple barcodes per part + pack quantities)
```sql
CREATE TABLE part_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_value VARCHAR(100) NOT NULL UNIQUE,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  pack_qty INTEGER DEFAULT 1,
  vendor_code VARCHAR(100),
  uom VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_barcode_value (barcode_value),
  INDEX idx_part_id (part_id)
);
```
**Purpose**: Enable scanning barcodes that map to parts; support case/pack barcodes with qty.

#### 2. **inventory_transfers** (warehouse ↔ shop transfers with status tracking)
```sql
CREATE TABLE inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number VARCHAR(100) NOT NULL UNIQUE,
  from_location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  to_location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  status ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED') DEFAULT 'DRAFT',
  initiated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMP,
  received_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_from_location (from_location_id),
  INDEX idx_to_location (to_location_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
```

#### 3. **inventory_transfer_lines** (line items in transfers)
```sql
CREATE TABLE inventory_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  qty_requested INTEGER NOT NULL,
  qty_sent INTEGER DEFAULT 0,
  qty_received INTEGER DEFAULT 0,
  unit_cost_at_time DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_transfer_id (transfer_id),
  INDEX idx_part_id (part_id)
);
```

#### 4. **customer_sales** (direct customer sales, no work order)
```sql
CREATE TABLE customer_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number VARCHAR(100) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  status ENUM ('DRAFT', 'COMPLETED', 'VOID') DEFAULT 'DRAFT',
  total_amount DECIMAL(12,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_customer_id (customer_id),
  INDEX idx_location_id (location_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
```

#### 5. **customer_sale_lines** (line items in customer sales)
```sql
CREATE TABLE customer_sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES customer_sales(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  barcode_id UUID REFERENCES part_barcodes(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  line_total DECIMAL(12,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_sale_id (sale_id),
  INDEX idx_part_id (part_id)
);
```

### Migration File to Create
**File**: `backend/migrations/20260227_add_barcodes_and_transfers.js`
- Create: part_barcodes, inventory_transfers, inventory_transfer_lines, customer_sales, customer_sale_lines
- Update: inventory_transactions (add missing reference_type enums if enum type exists, else document in code)

---

## STEP 2: BACKEND APIs

### Service Layer Additions

#### **barcodes.service.js** (new)
```js
- getByBarcode(barcodeValue) → {barcode, part, packQty}
- getByPartId(partId) → [barcodes]
- createBarcode(partId, barcodeValue, {packQty, vendorCode, uom}) → barcode
- updateBarcode(barcodeId, {packQty, vendorCode, is_active}) → barcode
- deactivateBarcode(barcodeId) → success
```

#### **transfers.service.js** (new)
```js
- createTransfer(fromLocationId, toLocationId, lines, {initiatedByUserId, notes})
  → transaction: creates inventory_transfers + inventory_transfer_lines + inventory_transactions (TRANSFER_OUT)
- getTransferById(id) → {transfer, lines with part details}
- listTransfers(filters: {fromLocation, toLocation, status, createdAfter})
- confirmTransferReceipt(transferId, {receivedByUserId, notes, lineQtys?})
  → transaction: updates inventory_transfers (status=RECEIVED, received_at) + 
    inventory_transfer_lines (qty_received) + 
    inventory_transactions (TRANSFER_IN for each line)
- cancelTransfer(transferId, reason) → updates status to CANCELLED
```

#### **customer-sales.service.js** (new)
```js
- createSale(customerId, locationId, {createdByUserId, notes}) → sale (status=DRAFT)
- addLineItem(saleId, {partId, barcode, qty, unitPrice}) 
  → transaction: adds to customer_sale_lines + updates inventory (reserves qty) + creates CONSUME transaction
- removeLineItem(saleId, lineId)
  → transaction: reverts inventory reservation + removes line
- completeSale(saleId)
  → transaction: marks sale COMPLETED + creates invoice + decrements inventory (CONSUME) + creates inventory_transactions
- voidSale(saleId, reason)
```

#### **inventory.service.js** (extend)
```js
// Add methods:
- consumeForWorkOrder(workOrderId, partId, locationId, qty, {userId, notes})
  → transaction: CONSUME inventory_transaction
- reserveForTransfer(locationId, partId, qty, transferId)
  → marks as reserved in inventory
- unreserveForTransfer(locationId, partId, qty)
```

### Route Files

#### **barcodes.js** (new)
```
GET    /api/barcodes/:code
       → Resolve barcode to part + on_hand for optional location_id
POST   /api/barcodes
       → Create barcode for part (auth: admin, parts_manager)
PUT    /api/barcodes/:id
       → Update barcode (pack_qty, vendor_code, is_active)
DELETE /api/barcodes/:id
       → Deactivate barcode
GET    /api/barcodes/part/:partId
       → List all barcodes for a part
```

#### **transfers.js** (new)
```
POST   /api/transfers
       → Create transfer (DRAFT) with line items
       → Request: {fromLocationId, toLocationId, lines: [{partId, qty}, ...], notes}
GET    /api/transfers
       → List transfers with filters (status, fromLocation, toLocation, date range)
GET    /api/transfers/:id
       → Get transfer details + lines with part info
POST   /api/transfers/:id/send
       → Mark transfer as SENT, create TRANSFER_OUT transactions
POST   /api/transfers/:id/receive
       → Mark transfer as RECEIVED, create TRANSFER_IN transactions
POST   /api/transfers/:id/cancel
       → Cancel transfer, revert any TRANSFER_OUT if not yet received
```

#### **sales.js** (new)
```
POST   /api/sales
       → Create direct customer sale (DRAFT)
       → Request: {customerId, locationId, notes}
POST   /api/sales/:id/add-line
       → Add part to sale, reserve inventory
       → Request: {partId, barcode?, qty, unitPrice}
DELETE /api/sales/:id/lines/:lineId
       → Remove line, unreserve inventory
POST   /api/sales/:id/complete
       → Complete sale, create invoice, deduct inventory, record transactions
GET    /api/sales/:id
       → Get sale + lines with part details
GET    /api/sales
       → List sales with filters (customer, location, status, date)
POST   /api/sales/:id/void
       → Void sale, revert all transactions
```

### Endpoint Details & Examples

#### GET /api/barcodes/:code
**Auth**: Any authenticated user  
**Response**:
```json
{
  "success": true,
  "data": {
    "barcode": {
      "id": "uuid",
      "barcode_value": "4500123456789",
      "pack_qty": 1,
      "vendor_code": "BRAKE-001"
    },
    "part": {
      "id": "uuid",
      "sku": "BRK-011",
      "name": "Brake Pad Set",
      "category": "Brakes",
      "default_retail_price": 85.00
    },
    "inventory_by_location": [
      {
        "location_id": "uuid",
        "location_name": "Garland",
        "on_hand_qty": 5,
        "reserved_qty": 2,
        "available_qty": 3
      }
    ]
  }
}
```

#### POST /api/transfers
**Auth**: admin, parts_manager, shop_manager  
**Request**:
```json
{
  "fromLocationId": "warehouse-uuid",
  "toLocationId": "shop-uuid",
  "lines": [
    {"partId": "part-uuid-1", "qty": 10},
    {"partId": "part-uuid-2", "qty": 5}
  ],
  "notes": "Weekly restock"
}
```
**Response**:
```json
{
  "success": true,
  "data": {
    "id": "transfer-uuid",
    "transfer_number": "TRF-20260227-0001",
    "status": "DRAFT",
    "lines": [...],
    "created_at": "2026-02-27T10:30:00Z"
  }
}
```

#### POST /api/sales/:id/add-line
**Auth**: service_advisor, shop_manager, technician  
**Request**:
```json
{
  "partId": "part-uuid",
  "barcode": "4500123456789",
  "qty": 2,
  "unitPrice": 85.00
}
```
**Transaction Logic**:
1. Begin DB transaction
2. Lock inventory row FOR UPDATE
3. Validate on_hand_qty >= qty
4. Insert customer_sale_lines
5. Decrement reserved_qty (or on_hand_qty if no reserved logic)
6. Create inventory_transactions (RESERVE or CONSUME)
7. Commit/rollback

---

## STEP 3: FRONTEND UI

### New Pages/Components

#### 1. **Barcode Management** (admin/parts_manager)
- **Path**: `/barcode-management`
- **Component**: `BarcodeManagementComponent`
- **Features**:
  - Search part by SKU or name
  - List barcodes for selected part
  - Add new barcode (with pack_qty, vendor_code)
  - Edit/deactivate barcodes
  - Prevent duplicate barcode assignment

#### 2. **Warehouse Receiving** (parts_manager, shop_manager)
- **Path**: `/receiving`
- **Component**: `ReceivingComponent`
- **Features**:
  - Scan barcode (bluetooth scanner optimized)
  - Auto-lookup barcode → part name + pack qty
  - On Enter: increment qty or add line
  - Shows running total
  - Select location + supplier
  - Submit receiving ticket
  - Real-time feedback (success/error toast)

#### 3. **Transfers** (parts_manager, shop_manager)
- **Path**: `/transfers`
- **Component**: `TransfersListComponent`
- **Sub-routes**:
  - `/transfers/new` → `TransferFormComponent` (create transfer)
  - `/transfers/:id` → `TransferDetailComponent` (view + receive)
- **Features**:
  - Create transfer: select from/to locations, scan parts, enter qty
  - List transfers with status filter
  - View transfer details + receive confirmation
  - Receive lines one-by-one (barcode scan) or bulk confirm

#### 4. **Direct Customer Sales** (service_advisor, shop_manager, technician)
- **Path**: `/customer-sales`
- **Component**: `CustomerSalesComponent`
- **Sub-routes**:
  - `/customer-sales/new` → `SaleFormComponent`
  - `/customer-sales/:id` → `SaleDetailComponent`
- **Features**:
  - Search customer by name/dot_number
  - Scan parts into cart (or manual entry)
  - Show running total + tax
  - Mark as complete → creates invoice
  - History/list of past sales

#### 5. **Inventory Reports** (all roles)
- **Path**: `/inventory/reports`
- **Component**: `InventoryReportsComponent`
- **Features**:
  - On-hand by location + part (pivot table)
  - Low stock alerts
  - Transaction history: date range, location, user, type filters
  - Export to CSV

### UI/UX Requirements
- **Scan Input**: Dedicated input field, always focused
- **On Enter**: Lookup barcode, add/increment line, clear input
- **Feedback**: Toast notifications (success/error)
- **Validation**: Show available qty before adding; prevent over-deduction
- **Mobile**: Responsive, large touch targets for scanner devices

---

## STEP 4: TESTING CHECKLIST

### 8 Manual Test Cases

1. **Barcode Creation & Lookup**
   - Create part "Brake Pads" with SKU "BRK-011"
   - Add barcode "4500123456789" with pack_qty=1
   - Verify GET /api/barcodes/4500123456789 returns part + inventory

2. **Warehouse Receiving (Happy Path)**
   - Open Receiving page
   - Scan barcode "4500123456789" → auto-shows "Brake Pads"
   - Enter qty 10, press Enter
   - Verify inventory increments (on_hand_qty +10)
   - Verify inventory_transactions record created (type=RECEIVE)

3. **Transfer Initiation**
   - Create transfer: Garland → Rockwall, 5x "Brake Pads"
   - Verify status = DRAFT, inventory not yet decremented
   - Press "Send" button
   - Verify Garland on_hand_qty -5, status=SENT
   - Verify inventory_transactions (TRANSFER_OUT)

4. **Transfer Receipt**
   - Receive transfer from Garland
   - Scan barcode or manually confirm 5x Brake Pads
   - Press "Complete Receipt"
   - Verify Rockwall on_hand_qty +5, status=RECEIVED
   - Verify 2 inventory_transactions (TRANSFER_OUT + TRANSFER_IN)

5. **Direct Customer Sale**
   - Create new sale: Customer "ABC Trucking", Location=Garland
   - Scan barcode "4500123456789" (Brake Pads), qty=2
   - Set unit price = $85 each
   - Verify reserved_qty = 2, available_qty = 8 (if started with 10)
   - Press "Complete Sale"
   - Verify invoice created, inventory_transactions (CONSUME), on_hand_qty -2

6. **Concurrent Consume Scenario (Race Condition Prevention)**
   - Inventory: Garland has 5x "Brake Pads", reserved=0
   - **Thread 1**: Try to consume 3x for Work Order #1
   - **Thread 2**: Try to consume 3x for Work Order #2 (simultaneous)
   - **Expected**: One succeeds, one fails ("insufficient inventory")
   - Verify on_hand_qty = 2, not -1 (negative not allowed)
   - Verify only 1 CONSUME transaction created

7. **Negative Stock Prevention**
   - Inventory: Garland has 2x "Brake Pads"
   - Try to create sale qty=5
   - **Expected**: Error "insufficient on_hand_qty"
   - Verify no transaction created, inventory unchanged

8. **Audit Trail Integrity**
   - Run 5 transfers + 3 sales
   - Query inventory_transactions with filters: location, date range, transaction_type
   - Verify all entries immutable (no UPDATE/DELETE on records, only INSERT)
   - Manually verify on_hand_qty = sum of all inventory_transactions qty_change for that part+location
   - Verify no gaps or duplicates

---

## FILE MANIFEST (TO BE CREATED)

### Database
- [ ] `backend/migrations/20260227_add_barcodes_and_transfers.js`

### Backend Services
- [ ] `backend/services/barcodes.service.js`
- [ ] `backend/services/transfers.service.js`
- [ ] `backend/services/customer-sales.service.js`
- [ ] `backend/services/inventory.service.js` (extend with reservation logic)

### Backend Routes
- [ ] `backend/routes/barcodes.js`
- [ ] `backend/routes/transfers.js`
- [ ] `backend/routes/sales.js`
- [ ] `backend/server.js` (register new routes)

### Frontend Components
- [ ] `frontend/src/app/components/barcode-management/`
  - barcode-management.component.ts
  - barcode-management.component.html
  - barcode-management.component.css
- [ ] `frontend/src/app/components/receiving/`
  - receiving.component.ts/html/css
- [ ] `frontend/src/app/components/transfers/`
  - transfers-list.component.ts/html/css
  - transfer-form.component.ts/html/css
  - transfer-detail.component.ts/html/css
- [ ] `frontend/src/app/components/customer-sales/`
  - sales-list.component.ts/html/css
  - sale-form.component.ts/html/css
  - sale-detail.component.ts/html/css
- [ ] `frontend/src/app/components/inventory-reports/`
  - inventory-reports.component.ts/html/css

### Routes & Navigation
- [ ] `frontend/src/app/app-routing.module.ts` (add new routes)
- [ ] `frontend/src/app/app.component.html` (update sidebar nav)
- [ ] `frontend/src/app/app.component.ts` (add new section toggle)

### API Service
- [ ] `frontend/src/app/services/api.service.ts` (add barcode, transfer, sales methods)

---

## CONVENTIONS TO FOLLOW

1. **API Response Format**:
   ```js
   { success: true, data: {...} } or { error: "message" }
   ```

2. **Role-Based Access**:
   - admin: all operations
   - parts_manager: barcodes, receiving, transfers, reports
   - shop_manager: receiving, transfers, sales
   - service_advisor: sales, work orders
   - technician: view inventory, consume for work orders

3. **Database Transactions**:
   ```js
   const trx = await db.transaction();
   try {
     // Lock row: const locked = await trx('inventory').where({...}).forUpdate().first();
     // Do operations
     await trx.commit();
   } catch (e) {
     await trx.rollback();
     throw e;
   }
   ```

4. **Logging**:
   - Use `dtLogger.info('action_success', {context})`
   - Use `dtLogger.error('action_failed', {context, error: e.message})`

5. **Error Handling**:
   - 400 Bad Request: missing/invalid params
   - 403 Forbidden: insufficient role
   - 404 Not Found: resource not found
   - 409 Conflict: duplicate barcode, race condition, insufficient inventory
   - 500 Server Error: DB transaction failure, unexpected

6. **Barcode Validation**:
   - Must be non-empty string
   - Prevent duplicate barcode_value (unique constraint)
   - Allow any format (EAN-13, Code128, QR, etc.)

---

## HOW TO RUN

### Backend
```bash
cd backend
npm install
npm run db:migrate  # Run migrations
npm run dev         # Start server on port 3000
```

### Frontend
```bash
cd frontend
npm install
npm start           # Start on http://localhost:4200
```

### Test API
```bash
# 1. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# 2. Create barcode
curl -X POST http://localhost:3000/api/barcodes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"partId":"<uuid>","barcodeValue":"4500123456789","packQty":1}'

# 3. Lookup barcode
curl http://localhost:3000/api/barcodes/4500123456789 \
  -H "Authorization: Bearer <token>"
```

---

## NEXT STEPS

1. ✅ **STEP 0 COMPLETE**: Repository discovery finished.
2. **STEP 1**: Create migrations file + update schema.
3. **STEP 2**: Implement backend services + routes.
4. **STEP 3**: Build frontend components.
5. **STEP 4**: Execute manual test cases.

**Ready to proceed?** Confirm and we'll start with Step 1.
