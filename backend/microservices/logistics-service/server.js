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
const PORT = process.env.PORT || 5006;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const uploadsPath = path.join(__dirname, '..', '..', 'goodmen-logistics', 'backend', 'uploads');
app.use('/uploads', express.static(uploadsPath));

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Logistics Service API',
    version: '1.0.0',
    description: 'API documentation for the Logistics microservice.'
  },
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
        description: 'Returns the health status of the Logistics service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/loads': {
      get: {
        summary: 'List loads',
        description: 'Retrieve loads and their current status.',
        responses: {
          '200': {
            description: 'Loads list returned'
          }
        }
      },
      post: {
        summary: 'Create load',
        description: 'Create a new load.',
        responses: {
          '201': {
            description: 'Load created'
          }
        }
      }
    },
    '/api/brokers': {
      get: {
        summary: 'List brokers',
        description: 'Retrieve broker records.',
        responses: {
          '200': {
            description: 'Brokers returned'
          }
        }
      }
    },
    '/api/locations': {
      get: {
        summary: 'List locations',
        description: 'Retrieve location data used for logistics and routing.',
        responses: {
          '200': {
            description: 'Locations returned'
          }
        }
      }
    },
    '/api/geo': {
      get: {
        summary: 'Geo utilities',
        description: 'Geo-related endpoints for mapping and routing.',
        responses: {
          '200': {
            description: 'Geo response'
          }
        }
      }
    },
    '/api/invoices': {
      get: {
        summary: 'List invoices',
        description: 'Retrieve invoices generated for loads.',
        responses: {
          '200': {
            description: 'Invoices returned'
          }
        }
      }
    },
    '/api/credit': {
      get: {
        summary: 'Credit checks',
        description: 'Endpoints related to credit checks and credit information.',
        responses: {
          '200': {
            description: 'Credit information returned'
          }
        }
      }
    },
    '/api/db-example': {
      get: {
        summary: 'Database example endpoint',
        description: 'Example route demonstrating database access.',
        responses: {
          '200': {
            description: 'Example data returned'
          }
        }
      }
    }
  }
};

const loadsRouter = require('@goodmen/shared/routes/loads');
const brokersRouter = require('@goodmen/shared/routes/brokers');
const locationsRouter = require('@goodmen/shared/routes/locations');
const geoRouter = require('@goodmen/shared/routes/geo');
const invoicesRouter = require('@goodmen/shared/routes/invoices');
const creditRouter = require('@goodmen/shared/routes/credit');
const dbExampleRouter = require('@goodmen/shared/routes/db-example');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/loads', loadsRouter);
app.use('/api/brokers', brokersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/db-example', dbExampleRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-logistics-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🚚 Logistics service running on http://localhost:${PORT}`);
});
