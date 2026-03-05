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
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerDocument = {
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
        description: 'Returns the health status of the Reporting service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/dashboard': {
      get: {
        summary: 'Dashboard data',
        description: 'Retrieve aggregated dashboard metrics for the fleet.',
        responses: {
          '200': {
            description: 'Dashboard data returned'
          }
        }
      }
    },
    '/api/reports': {
      get: {
        summary: 'Reports',
        description: 'Retrieve available reports and report data.',
        responses: {
          '200': {
            description: 'Reports returned'
          }
        }
      }
    },
    '/api/audit': {
      get: {
        summary: 'Audit logs',
        description: 'Retrieve audit log entries for system actions.',
        responses: {
          '200': {
            description: 'Audit entries returned'
          }
        }
      }
    }
  }
};

const dashboardRouter = require('@goodmen/shared/routes/dashboard');
const reportsRouter = require('@goodmen/shared/routes/reports');
const auditRouter = require('@goodmen/shared/routes/audit');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/audit', auditRouter);

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
