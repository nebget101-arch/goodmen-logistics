require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const dbConfig = require('@goodmen/shared/config/database');
const knex = require('@goodmen/shared/config/knex');
require('@goodmen/shared').setDatabase({
  pool: dbConfig.pool,
  query: dbConfig.query,
  getClient: dbConfig.getClient,
  knex
});

const app = express();
const PORT = process.env.PORT || 5007;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
const swaggerOptions = buildSwaggerOptions({
  title: 'Inventory Service API',
  description: 'API documentation for the Inventory microservice.',
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
});

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const inventoryRouter = require('@goodmen/shared/routes/inventory');
const adjustmentsRouter = require('@goodmen/shared/routes/adjustments');
const cycleCountsRouter = require('@goodmen/shared/routes/cycle-counts');
const receivingRouter = require('@goodmen/shared/routes/receiving');
const barcodesRouter = require('@goodmen/shared/routes/barcodes');
const shopClientsRouter = require('@goodmen/shared/routes/shop-clients');
const customerBulkUploadRouter = require('@goodmen/shared/routes/customer-bulk-upload');
const locationBinsRouter = require('@goodmen/shared/routes/location-bins');
const warehouseSupplyRulesRouter = require('@goodmen/shared/routes/warehouse-supply-rules');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');
// FN-1694: block expired-no-card / past-grace tenants (after tenant context,
// before plan checks). super_admin + billing routes exempt.
const requireActiveSubscription = require('@goodmen/shared/middleware/trial-enforcement-middleware')();

const requirePartsPlan = requirePlanAccess('/parts');
const requireReceivingPlan = requirePlanAccess('/receiving');
const requireBarcodesPlan = requirePlanAccess('/barcodes');

app.get('/api-docs-json', (_req, res) => res.json(swaggerSpec));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/inventory', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, inventoryRouter);
app.use('/api/adjustments', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, adjustmentsRouter);
app.use('/api/cycle-counts', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, cycleCountsRouter);
app.use('/api/receiving', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requireReceivingPlan, receivingRouter);
app.use('/api/barcodes', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requireBarcodesPlan, barcodesRouter);
app.use('/api/shop-clients', authMiddleware, tenantContextMiddleware, requireActiveSubscription, customerBulkUploadRouter);
app.use('/api/shop-clients', authMiddleware, tenantContextMiddleware, requireActiveSubscription, shopClientsRouter);
app.use('/api/locations/:locationId/bins', authMiddleware, tenantContextMiddleware, requireActiveSubscription, locationBinsRouter);
app.use('/api/locations/:id/supply-rules', authMiddleware, tenantContextMiddleware, requireActiveSubscription, warehouseSupplyRulesRouter);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 */
app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-inventory-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  try {
    await knex.migrate.latest();
    console.log('✅ Database migrations applied');
  } catch (err) {
    console.error('⚠️  Migration error (non-fatal):', err.message);
  }
  console.log(`📦 Inventory service running on http://localhost:${PORT}`);
});
