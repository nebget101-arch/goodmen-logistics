const dotenv = require('dotenv');
const path = require('path');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
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

const authRouter = require('@goodmen/shared/routes/auth');
const usersRouter = require('@goodmen/shared/routes/users');
const communicationPreferencesRouter = require('@goodmen/shared/routes/communication-preferences');
const rolesRouter = require('@goodmen/shared/routes/roles');
const trialRequestsRouter = require('@goodmen/shared/routes/trial-requests');
const billingRouter = require('./routes/billing');
const stripeWebhookRouter = require('./routes/stripe');
const permissionsRouter = require('@goodmen/shared/routes/permissions');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const { startTrialConversionJob } = require('@goodmen/shared/jobs/processTrialConversions');

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use('/api/stripe', stripeWebhookRouter);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Auth & Users Service API',
      version: '1.0.0',
      description: 'API documentation for the Auth & Users microservice.'
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

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/auth', authRouter);
app.use('/api/users', authMiddleware, tenantContextMiddleware, usersRouter);
app.use('/api/roles', authMiddleware, tenantContextMiddleware, rolesRouter);
app.use('/api/permissions', authMiddleware, tenantContextMiddleware, permissionsRouter);
app.use('/api/communication-preferences', authMiddleware, tenantContextMiddleware, communicationPreferencesRouter);
app.use('/api/billing', billingRouter);

// Public marketing endpoints – no auth middleware on the base route
// (individual admin sub-routes inside the router apply authMiddleware themselves)
app.use('/api/public/trial-requests', trialRequestsRouter);

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
    service: 'goodmen-auth-users-service',
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
  console.log(`🔐 Auth/Users service running on http://localhost:${PORT}`);
  // Start the daily trial conversion job
  startTrialConversionJob();
});
