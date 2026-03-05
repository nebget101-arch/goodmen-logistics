require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

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

const swaggerDocument = {
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
  ],
  servers: [
    {
      url: '/',
      description: 'Current server'
    }
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns the health status of the Vehicles & Maintenance service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/vehicles': {
      get: {
        summary: 'List vehicles',
        description: 'Retrieve vehicles managed by the maintenance service.',
        responses: {
          '200': {
            description: 'Vehicles returned'
          }
        }
      }
    },
    '/api/maintenance': {
      get: {
        summary: 'Maintenance records',
        description: 'Retrieve maintenance plans and history for vehicles and equipment.',
        responses: {
          '200': {
            description: 'Maintenance records returned'
          }
        }
      }
    },
    '/api/equipment': {
      get: {
        summary: 'List equipment',
        description: 'Retrieve equipment and asset records.',
        responses: {
          '200': {
            description: 'Equipment returned'
          }
        }
      }
    },
    '/api/work-orders': {
      get: {
        summary: 'Work orders',
        description: 'Retrieve maintenance work orders and their statuses.',
        responses: {
          '200': {
            description: 'Work orders returned'
          }
        }
      }
    },
    '/api/parts': {
      get: {
        summary: 'Parts catalog',
        description: 'Retrieve parts and related inventory for maintenance.',
        responses: {
          '200': {
            description: 'Parts returned'
          }
        }
      }
    }
  }
};

const vehiclesRouter = require('@goodmen/shared/routes/vehicles');
const maintenanceRouter = require('@goodmen/shared/routes/maintenance');
const equipmentRouter = require('@goodmen/shared/routes/equipment');
const workOrdersRouter = require('@goodmen/shared/routes/work-orders-hub');
const partsRouter = require('@goodmen/shared/routes/parts');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/parts', partsRouter);

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
