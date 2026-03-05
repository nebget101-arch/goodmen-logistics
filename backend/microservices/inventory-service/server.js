require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
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
const PORT = process.env.PORT || 5007;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Inventory Service API',
    version: '1.0.0',
    description: 'API documentation for the Inventory microservice.'
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
        description: 'Returns the health status of the Inventory service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/inventory': {
      get: {
        summary: 'List inventory',
        description: 'Retrieve inventory items and related data.',
        responses: {
          '200': {
            description: 'Inventory list returned'
          }
        }
      },
      post: {
        summary: 'Create or update inventory',
        description: 'Create or update inventory records.',
        responses: {
          '200': {
            description: 'Inventory record created or updated'
          }
        }
      }
    },
    '/api/adjustments': {
      get: {
        summary: 'List adjustments',
        description: 'Retrieve inventory adjustment records.',
        responses: {
          '200': {
            description: 'Adjustment list returned'
          }
        }
      },
      post: {
        summary: 'Create adjustment',
        description: 'Create a new inventory adjustment.',
        responses: {
          '201': {
            description: 'Adjustment created'
          }
        }
      }
    },
    '/api/cycle-counts': {
      get: {
        summary: 'List cycle counts',
        description: 'Retrieve cycle count sessions and results.',
        responses: {
          '200': {
            description: 'Cycle counts returned'
          }
        }
      }
    },
    '/api/receiving': {
      get: {
        summary: 'List receiving records',
        description: 'Retrieve inbound receiving records.',
        responses: {
          '200': {
            description: 'Receiving records returned'
          }
        }
      }
    },
    '/api/barcodes': {
      get: {
        summary: 'List barcodes',
        description: 'Retrieve barcodes and related metadata.',
        responses: {
          '200': {
            description: 'Barcodes returned'
          }
        }
      }
    },
    '/api/customers': {
      get: {
        summary: 'List customers',
        description: 'Retrieve customer records managed by the inventory service.',
        responses: {
          '200': {
            description: 'Customers returned'
          }
        }
      },
      post: {
        summary: 'Create or bulk upload customers',
        description: 'Create customers or upload them in bulk.',
        responses: {
          '201': {
            description: 'Customers created or uploaded'
          }
        }
      }
    }
  }
};

const inventoryRouter = require('@goodmen/shared/routes/inventory');
const adjustmentsRouter = require('@goodmen/shared/routes/adjustments');
const cycleCountsRouter = require('@goodmen/shared/routes/cycle-counts');
const receivingRouter = require('@goodmen/shared/routes/receiving');
const barcodesRouter = require('@goodmen/shared/routes/barcodes');
const customersRouter = require('@goodmen/shared/routes/customers');
const customerBulkUploadRouter = require('@goodmen/shared/routes/customer-bulk-upload');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/inventory', inventoryRouter);
app.use('/api/adjustments', adjustmentsRouter);
app.use('/api/cycle-counts', cycleCountsRouter);
app.use('/api/receiving', receivingRouter);
app.use('/api/barcodes', barcodesRouter);
app.use('/api/customers', customerBulkUploadRouter);
app.use('/api/customers', customersRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-inventory-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`📦 Inventory service running on http://localhost:${PORT}`);
});
