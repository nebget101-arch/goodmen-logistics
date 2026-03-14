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

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Inventory Service API',
      version: '1.0.0',
      description: 'API documentation for the Inventory microservice.'
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const inventoryRouter = require('@goodmen/shared/routes/inventory');
const adjustmentsRouter = require('@goodmen/shared/routes/adjustments');
const cycleCountsRouter = require('@goodmen/shared/routes/cycle-counts');
const receivingRouter = require('@goodmen/shared/routes/receiving');
const barcodesRouter = require('@goodmen/shared/routes/barcodes');
const customersRouter = require('@goodmen/shared/routes/customers');
const customerBulkUploadRouter = require('@goodmen/shared/routes/customer-bulk-upload');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');

const requirePartsPlan = requirePlanAccess('/parts');
const requireReceivingPlan = requirePlanAccess('/receiving');
const requireBarcodesPlan = requirePlanAccess('/barcodes');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/inventory', authMiddleware, tenantContextMiddleware, requirePartsPlan, inventoryRouter);
app.use('/api/adjustments', authMiddleware, tenantContextMiddleware, requirePartsPlan, adjustmentsRouter);
app.use('/api/cycle-counts', authMiddleware, tenantContextMiddleware, requirePartsPlan, cycleCountsRouter);
app.use('/api/receiving', authMiddleware, tenantContextMiddleware, requireReceivingPlan, receivingRouter);
app.use('/api/barcodes', authMiddleware, tenantContextMiddleware, requireBarcodesPlan, barcodesRouter);
app.use('/api/customers', authMiddleware, tenantContextMiddleware, customerBulkUploadRouter);
app.use('/api/customers', authMiddleware, tenantContextMiddleware, customersRouter);

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

app.listen(PORT, () => {
  console.log(`📦 Inventory service running on http://localhost:${PORT}`);
});
