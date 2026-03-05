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
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerDocument = {
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
        description: 'Returns the health status of the Auth & Users service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/auth': {
      post: {
        summary: 'Authenticate user',
        description: 'Authenticate a user and issue tokens.',
        responses: {
          '200': {
            description: 'User authenticated'
          },
          '401': {
            description: 'Invalid credentials'
          }
        }
      }
    },
    '/api/users': {
      get: {
        summary: 'List users',
        description: 'Retrieve users managed by the platform.',
        responses: {
          '200': {
            description: 'Users returned'
          }
        }
      },
      post: {
        summary: 'Create user',
        description: 'Create a new user.',
        responses: {
          '201': {
            description: 'User created'
          }
        }
      }
    },
    '/api/communication-preferences': {
      get: {
        summary: 'Get communication preferences',
        description: 'Retrieve communication preferences for users.',
        responses: {
          '200': {
            description: 'Communication preferences returned'
          }
        }
      },
      put: {
        summary: 'Update communication preferences',
        description: 'Update user communication preferences.',
        responses: {
          '200': {
            description: 'Preferences updated'
          }
        }
      }
    }
  }
};

const authRouter = require('@goodmen/shared/routes/auth');
const usersRouter = require('@goodmen/shared/routes/users');
const communicationPreferencesRouter = require('@goodmen/shared/routes/communication-preferences');

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/communication-preferences', communicationPreferencesRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-auth-users-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🔐 Auth/Users service running on http://localhost:${PORT}`);
});
