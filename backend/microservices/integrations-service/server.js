require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Integrations Service API',
    version: '1.0.0',
    description: 'API documentation for the Integrations microservice.'
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
        description: 'Returns the health status of the Integrations service.',
        responses: {
          '200': {
            description: 'Service is healthy'
          }
        }
      }
    },
    '/api/scan-bridge': {
      post: {
        summary: 'Scan bridge handler',
        description: 'Entry point for scanner/webhook integrations via the scan bridge.',
        responses: {
          '200': {
            description: 'Scan processed successfully'
          }
        }
      }
    }
  }
};

const scanBridgeRouter = require('@goodmen/shared/routes/scan-bridge');

app.use('/api/scan-bridge', scanBridgeRouter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'goodmen-integrations-service',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🔌 Integrations service running on http://localhost:${PORT}`);
});
