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

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Vehicles & Maintenance Service API',
      version: '1.0.0',
      description: 'API documentation for the Vehicles & Maintenance microservice.'
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

const vehiclesRouter = require('@goodmen/shared/routes/vehicles');
const maintenanceRouter = require('@goodmen/shared/routes/maintenance');
const equipmentRouter = require('@goodmen/shared/routes/equipment');
const workOrdersRouter = require('@goodmen/shared/routes/work-orders-hub');
const partsRouter = require('@goodmen/shared/routes/parts');
const authMiddleware = require('@goodmen/shared/middleware/auth-middleware');
const tenantContextMiddleware = require('@goodmen/shared/middleware/tenant-context-middleware');
const requirePlanAccess = require('@goodmen/shared/middleware/plan-access-middleware');

const requirePartsPlan = requirePlanAccess('/parts');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/vehicles', authMiddleware, tenantContextMiddleware, vehiclesRouter);
app.use('/api/maintenance', authMiddleware, tenantContextMiddleware, maintenanceRouter);
app.use('/api/equipment', authMiddleware, tenantContextMiddleware, equipmentRouter);
app.use('/api/work-orders', authMiddleware, tenantContextMiddleware, workOrdersRouter);
app.use('/api/parts', authMiddleware, tenantContextMiddleware, requirePartsPlan, partsRouter);

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

app.listen(PORT, () => {
  console.log(`🛠️ Vehicles maintenance service running on http://localhost:${PORT}`);
});
