require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const dbConfig = require('@goodmen/shared/config/database');
const knex = require('@goodmen/shared/config/knex');
require('@goodmen/shared').setDatabase({
  pool: dbConfig.pool,
  query: dbConfig.query,
  getClient: dbConfig.getClient,
  knex
});

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
const swaggerOptions = buildSwaggerOptions({
  title: 'Vehicles & Maintenance Service API',
  description: 'API documentation for the Vehicles & Maintenance microservice.',
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
});

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const vehiclesRouter = require('@goodmen/shared/routes/vehicles');
const vehiclePositionsRouter = require('@goodmen/shared/routes/vehicle-positions');
const maintenanceRouter = require('@goodmen/shared/routes/maintenance');
const equipmentRouter = require('@goodmen/shared/routes/equipment');
const workOrdersRouter = require('@goodmen/shared/routes/work-orders-hub');
const partsRouter = require('@goodmen/shared/routes/parts');
const manufacturersRouter = require('@goodmen/shared/routes/manufacturers');
const vendorsRouter = require('@goodmen/shared/routes/vendors');
// FN-1752: mock/stubbed vehicle telemetry (provider-agnostic shape) — defines
// GET /vehicles/:id/telemetry and GET /fleet/telemetry. Applies its own
// auth/tenant/subscription guard per-route, so it is mounted at /api directly.
const vehicleTelemetryRouter = require('@goodmen/shared/routes/vehicle-telemetry');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');
// FN-1694: block expired-no-card / past-grace tenants (after tenant context,
// before plan checks). super_admin + billing routes exempt.
const requireActiveSubscription = require('@goodmen/shared/middleware/trial-enforcement-middleware')();

const requirePartsPlan = requirePlanAccess('/parts');

app.get('/api-docs-json', (_req, res) => res.json(swaggerSpec));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/vehicles', authMiddleware, tenantContextMiddleware, requireActiveSubscription, vehiclesRouter);
app.use('/api/vehicle-positions', authMiddleware, tenantContextMiddleware, requireActiveSubscription, vehiclePositionsRouter);
app.use('/api/maintenance', authMiddleware, tenantContextMiddleware, requireActiveSubscription, maintenanceRouter);
app.use('/api/equipment', authMiddleware, tenantContextMiddleware, requireActiveSubscription, equipmentRouter);
app.use('/api/work-orders', authMiddleware, tenantContextMiddleware, requireActiveSubscription, workOrdersRouter);
app.use('/api/parts', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, partsRouter);
app.use('/api/manufacturers', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, manufacturersRouter);
app.use('/api/vendors', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requirePartsPlan, vendorsRouter);
// FN-1752: telemetry router carries its own per-route guard (auth + tenant +
// active subscription); mounted at /api so it can own both
// /api/vehicles/:id/telemetry and /api/fleet/telemetry. Registered LAST so the
// specific routers above match first and unknown paths fall through to 404.
app.use('/api', vehicleTelemetryRouter);

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
    service: 'goodmen-vehicles-maintenance-service',
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
  console.log(`🛠️ Vehicles maintenance service running on http://localhost:${PORT}`);
});
