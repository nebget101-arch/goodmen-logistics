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
const PORT = process.env.PORT || 5004;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Drivers Compliance Service API',
      version: '1.0.0',
      description: 'API documentation for the Drivers Compliance microservice.'
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

const driversRouter = require('@goodmen/shared/routes/drivers');
const dqfRouter = require('@goodmen/shared/routes/dqf');
const dqfDocumentsRouter = require('@goodmen/shared/routes/dqf-documents');
const hosRouter = require('@goodmen/shared/routes/hos');
const drugAlcoholRouter = require('@goodmen/shared/routes/drug-alcohol');
const onboardingRouter = require('@goodmen/shared/routes/onboarding');
const employmentApplicationRouter = require('@goodmen/shared/routes/employment-application');
const publicOnboardingRouter = require('@goodmen/shared/routes/public-onboarding');
const roadsideRouter = require('@goodmen/shared/routes/roadside');
const publicRoadsideRouter = require('@goodmen/shared/routes/public-roadside');
const safetyRouter = require('@goodmen/shared/routes/safety');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');

const requireRoadsidePlan = requirePlanAccess('/roadside');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/drivers', authMiddleware, tenantContextMiddleware, driversRouter);
app.use('/api/dqf', authMiddleware, tenantContextMiddleware, dqfRouter);
app.use('/api/dqf-documents', authMiddleware, tenantContextMiddleware, dqfDocumentsRouter);
app.use('/api/hos', authMiddleware, tenantContextMiddleware, hosRouter);
app.use('/api/drug-alcohol', authMiddleware, tenantContextMiddleware, drugAlcoholRouter);
app.use('/api/onboarding', authMiddleware, tenantContextMiddleware, onboardingRouter);
app.use('/api/employment', authMiddleware, tenantContextMiddleware, employmentApplicationRouter);
app.use('/api/roadside', authMiddleware, tenantContextMiddleware, requireRoadsidePlan, roadsideRouter);
app.use('/api/safety', authMiddleware, tenantContextMiddleware, safetyRouter);
app.use('/public/onboarding', publicOnboardingRouter);
app.use('/public/roadside', publicRoadsideRouter);

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
    service: 'goodmen-drivers-compliance-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🧑‍✈️ Drivers compliance service running on http://localhost:${PORT}`);
});
