/**
 * Shared OpenAPI / Swagger configuration for all FleetNeuron microservices.
 *
 * Usage in each service's server.js:
 *   const { buildSwaggerOptions } = require('@goodmen/shared/config/swagger');
 *   const swaggerOptions = buildSwaggerOptions({
 *     title: 'My Service API',
 *     description: 'API documentation for My Service.',
 *     apis: [path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'), __filename]
 *   });
 *   const swaggerSpec = swaggerJsdoc(swaggerOptions);
 */

const sharedDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'FleetNeuron API',
    version: '2.0.0',
    description: 'AI-powered fleet management platform API',
    contact: { name: 'FleetNeuron', url: 'https://fleetneuron.ai' }
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Local Gateway' },
    { url: 'https://fleetneuron-logistics-gateway-dev.onrender.com', description: 'Dev' },
    { url: 'https://fleetneuron-logistics-gateway.onrender.com', description: 'Production' }
  ],
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
};

/**
 * Build swagger-jsdoc options for a specific service.
 *
 * @param {object} opts
 * @param {string} opts.title - Service-specific API title
 * @param {string} opts.description - Service-specific API description
 * @param {string[]} opts.apis - Glob paths for route files to scan
 * @returns {object} Options object for swagger-jsdoc()
 */
function buildSwaggerOptions({ title, description, apis }) {
  return {
    definition: {
      ...sharedDefinition,
      info: {
        ...sharedDefinition.info,
        title: title || sharedDefinition.info.title,
        description: description || sharedDefinition.info.description
      }
    },
    apis: apis || []
  };
}

module.exports = {
  sharedDefinition,
  buildSwaggerOptions
};
