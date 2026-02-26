const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.dynatrace') });

// Debug: Print loaded Dynatrace environment variables
console.log('DYNATRACE_ENVIRONMENT_URL:', process.env.DYNATRACE_ENVIRONMENT_URL);
console.log('DYNATRACE_API_TOKEN:', process.env.DYNATRACE_API_TOKEN ? 'set' : 'not set');
console.log('DYNATRACE_ENABLED:', process.env.DYNATRACE_ENABLED);

const { sendTestMetricLine } = require('./config/dynatrace-sdk');
sendTestMetricLine();
// Initialize Dynatrace SDK (must be first)
const { 
  initializeDynatrace, 
  dynatraceMiddleware,
  sendLog 
} = require('./config/dynatrace-sdk');

// Initialize Dynatrace
initializeDynatrace();

const app = express();
const PORT = process.env.PORT || 3000;

// Test database connection on startup
const { pool } = require('./config/database');

// Function to create missing work order tables
async function ensureWorkOrderTables() {
  try {
    const queries = [
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS labor_subtotal DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS parts_subtotal DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fees_subtotal DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS total_amount DECIMAL(12,2) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tax_rate_percent DECIMAL(6,3) DEFAULT 0`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS type VARCHAR(50)`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS priority VARCHAR(50)`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description VARCHAR(1000)`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS odometer_miles INTEGER`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_mechanic_user_id UUID`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS requested_by_user_id UUID`,
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS work_order_number VARCHAR(100)`,
      `ALTER TABLE parts ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'`,
      `ALTER TABLE parts ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255)`,
      `ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL`,
      `CREATE TABLE IF NOT EXISTS parts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description VARCHAR(500),
        category VARCHAR(100),
        manufacturer VARCHAR(255),
        unit_cost DECIMAL(10,2),
        unit_price DECIMAL(10,2),
        quantity_on_hand INTEGER DEFAULT 0,
        reorder_level INTEGER DEFAULT 10,
        supplier_id UUID,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS locations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        address VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(2),
        zip VARCHAR(20),
        phone VARCHAR(32),
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
        on_hand_qty INTEGER DEFAULT 0,
        reserved_qty INTEGER DEFAULT 0,
        bin_location VARCHAR(100),
        min_stock_level INTEGER DEFAULT 0,
        reorder_qty INTEGER,
        last_counted_at TIMESTAMP,
        last_received_at TIMESTAMP,
        last_issued_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (location_id, part_id)
      )`,
      `CREATE TABLE IF NOT EXISTS inventory_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
        transaction_type VARCHAR(50) NOT NULL,
        qty_change INTEGER NOT NULL,
        unit_cost_at_time DECIMAL(10,2),
        reference_type VARCHAR(50) NOT NULL,
        reference_id UUID NOT NULL,
        performed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_labor_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        description VARCHAR(500),
        hours DECIMAL(10,2),
        labor_rate DECIMAL(10,2),
        taxable BOOLEAN DEFAULT false,
        line_total DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `ALTER TABLE work_order_part_items ADD COLUMN IF NOT EXISTS taxable BOOLEAN DEFAULT false`,
      `ALTER TABLE work_order_labor_items ADD COLUMN IF NOT EXISTS mechanic_user_id UUID`,
      `CREATE TABLE IF NOT EXISTS work_order_part_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        part_id UUID REFERENCES parts(id),
        location_id UUID REFERENCES locations(id),
        qty_requested INTEGER,
        qty_reserved INTEGER,
        qty_issued INTEGER,
        unit_price DECIMAL(10,2),
        taxable BOOLEAN DEFAULT false,
        status VARCHAR(50),
        line_total DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_fees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        fee_type VARCHAR(100),
        amount DECIMAL(10,2),
        taxable BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS work_order_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        file_size_bytes INTEGER,
        storage_key VARCHAR(500),
        uploaded_by_user_id UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_parts_sku ON parts(sku)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(location_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_part ON inventory(part_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_location_part ON inventory(location_id, part_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_transactions_location ON inventory_transactions(location_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_transactions_part ON inventory_transactions(part_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at ON inventory_transactions(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category)`,
      `CREATE INDEX IF NOT EXISTS idx_parts_manufacturer ON parts(manufacturer)`,
      `CREATE TABLE IF NOT EXISTS invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_order_id UUID REFERENCES work_orders(id) ON DELETE CASCADE,
        invoice_number VARCHAR(100) UNIQUE,
        customer_id UUID REFERENCES customers(id),
        amount DECIMAL(12,2),
        tax_amount DECIMAL(12,2) DEFAULT 0,
        total_amount DECIMAL(12,2),
        status VARCHAR(50) DEFAULT 'DRAFT',
        issue_date TIMESTAMP,
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_work_order_id ON invoices(work_order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id)`,
      `CREATE TABLE IF NOT EXISTS customer_pricing_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
        markup_percentage DECIMAL(10,2) DEFAULT 0,
        discount_percentage DECIMAL(10,2) DEFAULT 0,
        labor_rate_multiplier DECIMAL(10,3) DEFAULT 1,
        effective_date DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_customer_pricing_rules_customer ON customer_pricing_rules(customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_work_order_labor_items_work_order_id ON work_order_labor_items(work_order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_work_order_part_items_work_order_id ON work_order_part_items(work_order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_work_order_fees_work_order_id ON work_order_fees(work_order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_work_order_documents_work_order_id ON work_order_documents(work_order_id)`
    ];

    for (const query of queries) {
      try {
        await pool.query(query);
      } catch (e) {
        // Silently skip errors about already existing indexes or tables
        if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
          console.warn('Warning during table creation:', e.message);
        }
      }
    }
    console.log('✅ Work order tables verified/created');
    return true;
  } catch (error) {
    console.error('⚠️  Could not create work order tables:', error.message);
    return false;
  }
}

// Test database connection on startup with async handling
(async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Database connected successfully');
    // Ensure work order tables exist
    await ensureWorkOrderTables();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('💡 Run "npm run db:init" to initialize the database');
  }
})();

// Middleware
app.use(cors());

// Dynatrace request tracking middleware (add before other routes)
app.use(dynatraceMiddleware);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
const driversRouter = require('./routes/drivers');
const vehiclesRouter = require('./routes/vehicles');
const hosRouter = require('./routes/hos');
const maintenanceRouter = require('./routes/maintenance');
const drugAlcoholRouter = require('./routes/drug-alcohol');
const loadsRouter = require('./routes/loads');
const dashboardRouter = require('./routes/dashboard');
const auditRouter = require('./routes/audit');
const dbExampleRouter = require('./routes/db-example');
const dqfDocumentsRouter = require('./routes/dqf-documents');
const invoicesRouter = require('./routes/invoices');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const workOrdersRouter = require('./routes/work-orders-hub');
const partsRouter = require('./routes/parts');
const inventoryRouter = require('./routes/inventory');
const receivingRouter = require('./routes/receiving');
const adjustmentsRouter = require('./routes/adjustments');
const cycleCountsRouter = require('./routes/cycle-counts');
const reportsRouter = require('./routes/reports');
const creditRouter = require('./routes/credit');

const locationsRouter = require('./routes/locations');
const customersRouter = require('./routes/customers');

// Use routes

app.use('/api/customers', customersRouter);
app.use('/api/users', usersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/hos', hosRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/drug-alcohol', drugAlcoholRouter);
app.use('/api/loads', loadsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/audit', auditRouter);
app.use('/api/db-example', dbExampleRouter);
app.use('/api/dqf-documents', dqfDocumentsRouter);
app.use('/api/auth', authRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/credit', creditRouter);
// Inventory Management Routes (Phase 2)
app.use('/api/parts', partsRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/receiving', receivingRouter);
app.use('/api/adjustments', adjustmentsRouter);
app.use('/api/cycle-counts', cycleCountsRouter);
app.use('/api/reports', reportsRouter);

// Health check
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    message: 'Goodmen Logistics API is running',
    dynatrace: process.env.DYNATRACE_ENABLED === 'true' ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString()
  };
  
  // Track health check in Dynatrace
  await sendLog('INFO', 'Health check requested', healthStatus);
  
  res.json(healthStatus);
});

// Serve Angular frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist', 'goodmen-logistics');
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚛 Goodmen Logistics Backend running on http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🗄️  Database Examples: http://localhost:${PORT}/api/db-example/drivers`);
  
  // Log startup event to Dynatrace
  await sendLog('INFO', 'Server started successfully', { port: PORT });
});
