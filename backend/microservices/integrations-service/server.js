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

// FN-1451: SAFER scraper + Bull scrape queue retired. The integrations
// service no longer initializes a scrape queue on boot. FMCSA reference data
// now comes from the bulk-importer pipeline (FN-1412/1420/1422) and is read
// via fmcsa-reference (FN-1427).

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
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await knex.destroy();
  process.exit(0);
});
