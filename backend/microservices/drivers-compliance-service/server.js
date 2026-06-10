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
const PORT = process.env.PORT || 5004;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
const swaggerOptions = buildSwaggerOptions({
  title: 'Drivers Compliance Service API',
  description: 'API documentation for the Drivers Compliance microservice.',
  apis: [
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    path.join(__dirname, 'src/routes/*.js'),
    __filename
  ]
});

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
const consentsRouter = require('@goodmen/shared/routes/consents');
const publicConsentsRouter = require('@goodmen/shared/routes/public-consents');
const safetyRouter = require('@goodmen/shared/routes/safety');
const safetyRiskEngineRouter = require('@goodmen/shared/routes/safety-risk-engine');
const employerInvestigationsRouter = require('@goodmen/shared/routes/employer-investigations');
const publicEmployerInvestigationsRouter = require('@goodmen/shared/routes/public-employer-investigations');
const annualComplianceRouter = require('@goodmen/shared/routes/annual-compliance');
const addressRouter = require('@goodmen/shared/routes/address');
const incidentsTriageRouter = require('./src/routes/triage.routes');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');
// FN-1694: block expired-no-card / past-grace tenants (after tenant context,
// before plan checks). super_admin + billing routes exempt.
const requireActiveSubscription = require('@goodmen/shared/middleware/trial-enforcement-middleware')();

const requireRoadsidePlan = requirePlanAccess('/roadside');

app.get('/api-docs-json', (_req, res) => res.json(swaggerSpec));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/drivers', authMiddleware, tenantContextMiddleware, requireActiveSubscription, driversRouter);
app.use('/api/dqf', authMiddleware, tenantContextMiddleware, requireActiveSubscription, dqfRouter);
app.use('/api/dqf-documents', authMiddleware, tenantContextMiddleware, requireActiveSubscription, dqfDocumentsRouter);
app.use('/api/hos', authMiddleware, tenantContextMiddleware, requireActiveSubscription, hosRouter);
app.use('/api/drug-alcohol', authMiddleware, tenantContextMiddleware, requireActiveSubscription, drugAlcoholRouter);
app.use('/api/onboarding', authMiddleware, tenantContextMiddleware, requireActiveSubscription, onboardingRouter);
app.use('/api/employment', authMiddleware, tenantContextMiddleware, requireActiveSubscription, employmentApplicationRouter);
app.use('/api/roadside', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requireRoadsidePlan, roadsideRouter);
app.use('/api/safety', authMiddleware, tenantContextMiddleware, requireActiveSubscription, safetyRouter);
app.use('/api/safety/driver-risk-scores', authMiddleware, tenantContextMiddleware, requireActiveSubscription, safetyRiskEngineRouter);
app.use('/api/consents', authMiddleware, tenantContextMiddleware, requireActiveSubscription, consentsRouter);
app.use('/api/employer-investigations', authMiddleware, tenantContextMiddleware, requireActiveSubscription, employerInvestigationsRouter);
app.use('/api/annual-compliance', authMiddleware, tenantContextMiddleware, requireActiveSubscription, annualComplianceRouter);
app.use('/public/onboarding', publicOnboardingRouter);
app.use('/public/roadside', publicRoadsideRouter);
app.use('/public/consents', publicConsentsRouter);
app.use('/public/employer-investigations', publicEmployerInvestigationsRouter);
app.use('/api/address', addressRouter);
app.use('/api/incidents', authMiddleware, tenantContextMiddleware, requireActiveSubscription, requireRoadsidePlan, incidentsTriageRouter);

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

app.listen(PORT, async () => {
  try {
    await knex.migrate.latest();
    console.log('✅ Database migrations applied');
  } catch (err) {
    console.error('⚠️  Migration error (non-fatal):', err.message);
  }
  console.log(`🧑‍✈️ Drivers compliance service running on http://localhost:${PORT}`);
});
