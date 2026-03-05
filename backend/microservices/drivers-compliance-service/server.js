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
const PORT = process.env.PORT || 5004;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Drivers Compliance Service API',
    version: '1.0.0',
    description: 'API documentation for the Drivers Compliance microservice.'
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
        description: 'Returns the health status of the Drivers Compliance service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/drivers': {
      get: {
        summary: 'List drivers',
        description: 'Retrieve drivers and their compliance information.',
        responses: {
          '200': {
            description: 'Drivers returned'
          }
        }
      }
    },
    '/api/dqf': {
      get: {
        summary: 'DQF records',
        description: 'Endpoints related to driver qualification files (DQF).',
        responses: {
          '200': {
            description: 'DQF records returned'
          }
        }
      }
    },
    '/api/dqf-documents': {
      get: {
        summary: 'DQF documents',
        description: 'Retrieve documents associated with driver qualification files.',
        responses: {
          '200': {
            description: 'DQF documents returned'
          }
        }
      }
    },
    '/api/hos': {
      get: {
        summary: 'Hours of Service',
        description: 'Retrieve Hours of Service (HOS) compliance data.',
        responses: {
          '200': {
            description: 'HOS data returned'
          }
        }
      }
    },
    '/api/drug-alcohol': {
      get: {
        summary: 'Drug and alcohol testing',
        description: 'Endpoints related to drug and alcohol testing records.',
        responses: {
          '200': {
            description: 'Drug and alcohol records returned'
          }
        }
      }
    },
    '/api/onboarding': {
      get: {
        summary: 'Driver onboarding',
        description: 'Endpoints for internal driver onboarding workflows.',
        responses: {
          '200': {
            description: 'Onboarding data returned'
          }
        }
      }
    },
    '/public/onboarding': {
      get: {
        summary: 'Public driver onboarding',
        description: 'Public-facing onboarding endpoints for drivers.',
        responses: {
          '200': {
            description: 'Public onboarding data returned'
          }
        }
      }
    }
  }
};

const driversRouter = require('@goodmen/shared/routes/drivers');
const dqfRouter = require('@goodmen/shared/routes/dqf');
const dqfDocumentsRouter = require('@goodmen/shared/routes/dqf-documents');
const hosRouter = require('@goodmen/shared/routes/hos');
const drugAlcoholRouter = require('@goodmen/shared/routes/drug-alcohol');
const onboardingRouter = require('@goodmen/shared/routes/onboarding');
const publicOnboardingRouter = require('@goodmen/shared/routes/public-onboarding');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/drivers', driversRouter);
app.use('/api/dqf', dqfRouter);
app.use('/api/dqf-documents', dqfDocumentsRouter);
app.use('/api/hos', hosRouter);
app.use('/api/drug-alcohol', drugAlcoholRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/public/onboarding', publicOnboardingRouter);

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
