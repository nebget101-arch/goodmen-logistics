require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ─── Database initialization ─────────────────────────────────────────────────
const knexConfig = require('@goodmen/database/knexfile');
const knex = require('knex')(knexConfig[process.env.NODE_ENV || 'development'] || knexConfig.development);
const { setDatabase } = require('@goodmen/shared/internal/db');
setDatabase({ knex });

// ─── Auth middleware (needed for FMCSA safety routes) ────────────────────────
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requireInternalTenant = require('@goodmen/shared/middleware/require-internal-tenant');
const { loadUserRbac, requirePermission } = require('@goodmen/shared/middleware/rbac-middleware');

const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
const swaggerOptions = buildSwaggerOptions({
  title: 'Integrations Service API',
  description: 'API documentation for the Integrations microservice.',
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
});

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const scanBridgeRouter = require('@goodmen/shared/routes/scan-bridge');
const fmcsaRouter = require('@goodmen/shared/routes/fmcsa');
const fmcsaSafetyRouter = require('@goodmen/shared/routes/fmcsa-safety');
const { createImportsRouter } = require('@goodmen/shared/routes/fmcsa-imports');
const inboundEmailWebhookRouter = require('./routes/inbound-email-webhook');
const inboundEmailRouter = require('@goodmen/shared/routes/inbound-email');

app.use('/api/scan-bridge', scanBridgeRouter);
app.use('/api/fmcsa', fmcsaRouter);
app.use('/api/fmcsa/safety', authMiddleware, tenantContextMiddleware, fmcsaSafetyRouter);

// Inbound email provider webhook — public endpoint, auth via shared secret.
app.use('/api/webhooks/email-inbound', inboundEmailWebhookRouter);

// Tenant-facing inbound-email settings and logs (authenticated).
app.use(
  '/api/tenants/me/inbound-email',
  authMiddleware,
  tenantContextMiddleware,
  inboundEmailRouter
);

app.get('/api-docs-json', (_req, res) => res.json(swaggerSpec));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Bull Queue initialization ───────────────────────────────────────────────
// FN-1451: SAFER scraper + Bull scrape queue retired. FMCSA reference data
// now comes from the bulk-importer pipeline (FN-1412/1420/1422) and is read
// via fmcsa-reference (FN-1427).
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let importQueueInstance = null;

async function initImportQueue() {
  if (!process.env.REDIS_URL) {
    console.warn('[integrations] REDIS_URL not set — FMCSA import queue disabled.');
    return;
  }
  try {
    const { createImportQueue } = require('@goodmen/shared/services/fmcsa-import-queue');
    const { getRegisteredImporters } = require('@goodmen/shared/services/fmcsa-importer/register-importers');
    importQueueInstance = createImportQueue({ redisUrl: REDIS_URL });
    // FN-1452: bind the five FMCSA file importers to the queue's registry.
    // Without this, every `run-import` job hits the no-importer branch and
    // writes status='error' to fmcsa.import_runs.
    for (const [file, fn] of getRegisteredImporters()) {
      importQueueInstance.registerImporter(file, fn);
    }
    await importQueueInstance.initScheduler();
    console.log('[integrations] FMCSA import queue initialized (5 importers registered)');
  } catch (err) {
    console.error('[integrations] Failed to initialize import queue:', err.message);
  }
}

// FMCSA import control plane (FleetNeuron-internal admin only).
// The router is built lazily once the queue is constructed during startup.
app.use(
  '/api/fmcsa/imports',
  authMiddleware,
  tenantContextMiddleware,
  requireInternalTenant,
  loadUserRbac,
  requirePermission('fmcsa.imports.manage'),
  (req, res, next) => {
    if (!importQueueInstance) {
      return res.status(503).json({ success: false, error: 'FMCSA import queue unavailable (Redis not connected)' });
    }
    if (!app.locals._fmcsaImportsRouter) {
      app.locals._fmcsaImportsRouter = createImportsRouter({ importQueue: importQueueInstance });
    }
    return app.locals._fmcsaImportsRouter(req, res, next);
  }
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
  res.json({
    status: 'ok',
    service: 'goodmen-integrations-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, async () => {
  try {
    await knex.migrate.latest();
    console.log('✅ Database migrations applied');
  } catch (err) {
    console.error('⚠️  Migration error (non-fatal):', err.message);
  }
  console.log(`🔌 Integrations service running on http://localhost:${PORT}`);
  await initImportQueue();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (importQueueInstance) {
    await importQueueInstance.shutdown();
  }
  await knex.destroy();
  process.exit(0);
});
