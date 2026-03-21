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

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Reporting Service API',
      version: '1.0.0',
      description: 'API documentation for the Reporting & Audit microservice.'
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

const dashboardRouter = require('@goodmen/shared/routes/dashboard');
const reportsRouter = require('@goodmen/shared/routes/reports');
const auditRouter = require('@goodmen/shared/routes/audit');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const { loadUserRbac } = require('@goodmen/shared/middleware/rbac-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');

const requireReportsPlan = requirePlanAccess('/reports');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/dashboard', authMiddleware, tenantContextMiddleware, dashboardRouter);
app.use('/api/reports', authMiddleware, tenantContextMiddleware, requireReportsPlan, reportsRouter);
app.use('/api/audit', authMiddleware, tenantContextMiddleware, loadUserRbac, auditRouter);

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

app.listen(PORT, () => {
  console.log(`📊 Reporting service running on http://localhost:${PORT}`);
});
