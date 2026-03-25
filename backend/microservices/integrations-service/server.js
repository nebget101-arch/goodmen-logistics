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

// ─── Auth middleware (needed for FMCSA safety routes) ────────────────────────
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Integrations Service API',
      version: '1.0.0',
      description: 'API documentation for the Integrations microservice.'
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

const scanBridgeRouter = require('@goodmen/shared/routes/scan-bridge');
const fmcsaRouter = require('@goodmen/shared/routes/fmcsa');
const fmcsaSafetyRouter = require('@goodmen/shared/routes/fmcsa-safety');

app.use('/api/scan-bridge', scanBridgeRouter);
app.use('/api/fmcsa', fmcsaRouter);
app.use('/api/fmcsa/safety', authMiddleware, tenantContextMiddleware, fmcsaSafetyRouter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ─── Bull Queue initialization ───────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let scrapeQueueInstance = null;

async function initScrapeQueue() {
  try {
    const { createScrapeQueue } = require('@goodmen/shared/services/fmcsa-scrape-queue');
    scrapeQueueInstance = createScrapeQueue(knex, REDIS_URL);
    fmcsaSafetyRouter.initQueue(scrapeQueueInstance);
    scrapeQueueInstance.initScheduler();
    console.log('[integrations] FMCSA scrape queue initialized with daily scheduler');
  } catch (err) {
    console.error('[integrations] Failed to initialize scrape queue:', err.message);
    console.error('[integrations] FMCSA scraping will be unavailable. Ensure Redis is running.');
  }
}

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
    scrapeQueue: scrapeQueueInstance ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, async () => {
  console.log(`🔌 Integrations service running on http://localhost:${PORT}`);
  await initScrapeQueue();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (scrapeQueueInstance) {
    await scrapeQueueInstance.shutdown();
  }
  await knex.destroy();
  process.exit(0);
});
