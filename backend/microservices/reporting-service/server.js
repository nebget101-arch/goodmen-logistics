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
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
const swaggerOptions = buildSwaggerOptions({
  title: 'Reporting Service API',
  description: 'API documentation for the Reporting & Audit microservice.',
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
});

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const dashboardRouter = require('@goodmen/shared/routes/dashboard');
const reportsRouter = require('@goodmen/shared/routes/reports');
const auditRouter = require('@goodmen/shared/routes/audit');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const { loadUserRbac } = require('@goodmen/shared/middleware/rbac-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');
// FN-1694: block expired-no-card / past-grace tenants (after tenant context,
// before plan checks). super_admin + billing routes exempt.
const requireActiveSubscription = require('@goodmen/shared/middleware/trial-enforcement-middleware')();

const { buildTrendCache } = require('./services/trend-cache');
const { buildTrendAggregator } = require('./services/trend-aggregator');
const { buildInsightsRouter } = require('./routes/insights');

const requireReportsPlan = requirePlanAccess('/reports');

app.get('/api-docs-json', (_req, res) => res.json(swaggerSpec));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/dashboard', authMiddleware, tenantContextMiddleware, requireActiveSubscription, dashboardRouter);
app.use('/api/reports', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requireReportsPlan, reportsRouter);
app.use('/api/audit', authMiddleware, tenantContextMiddleware, requireActiveSubscription, loadUserRbac, auditRouter);

// FN-1306: Predictive Insights & Trends — relocated from gateway. Caches per-tenant
// trend bundles for 10 min in-memory; sparse-data tolerant (returns nulls, not errors).
const trendCache = buildTrendCache();
const trendAggregator = buildTrendAggregator({ knex, cache: trendCache });
app.use(
  '/api/insights',
  buildInsightsRouter({
    aggregator: trendAggregator,
    jwtSecret: process.env.JWT_SECRET || 'dev_secret'
  })
);

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
    service: 'goodmen-reporting-service',
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
  console.log(`📊 Reporting service running on http://localhost:${PORT}`);
});
