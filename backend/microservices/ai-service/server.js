require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const { OpenAI } = require('openai');

const { buildAiRouter } = require('./src/ai-router');

const PORT = process.env.AI_SERVICE_PORT || 4100;

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    credentials: true
  })
);

app.use(bodyParser.json({ limit: '20mb' }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'AI Service API',
      version: '1.0.0',
      description: 'FleetNeuron AI Service — chat, vision extraction, analysis, and intelligent recommendations powered by OpenAI and Anthropic models.'
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
    path.join(__dirname, 'src/ai-router.js'),
    __filename
  ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
  res.json({
    status: 'ok',
    service: 'ai-service'
  });
});

app.use('/api/ai', buildAiRouter({ openai }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AI service listening on port ${PORT}`);
});

