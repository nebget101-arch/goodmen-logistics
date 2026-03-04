require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

const PORT = process.env.PORT || 4000;
const TARGET_BACKEND_URL =
  process.env.TARGET_BACKEND_URL || 'http://localhost:3000';
const REPORTING_SERVICE_URL =
  process.env.REPORTING_SERVICE_URL || TARGET_BACKEND_URL;
const INTEGRATIONS_SERVICE_URL =
  process.env.INTEGRATIONS_SERVICE_URL || TARGET_BACKEND_URL;
const isProd = process.env.NODE_ENV === 'production';

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    credentials: true
  })
);

// Log incoming requests (verbose in development only)
if (!isProd) {
  app.use((req, _res, next) => {
    // eslint-disable-next-line no-console
    console.log(`[gateway] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// Simple health endpoint on the gateway itself
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    gateway: 'fleetneuron-api-gateway',
    target: TARGET_BACKEND_URL
  });
});

function buildProxy(target, label) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path) => '/api' + (path.startsWith('/') ? path : '/' + path),
    logLevel: isProd ? 'warn' : 'debug',
    onProxyReq: isProd
      ? undefined
      : (proxyReq, req) => {
          // eslint-disable-next-line no-console
          console.log(
            `[gateway->${label}] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`
          );
        },
    onError: (err, req, res) => {
      // eslint-disable-next-line no-console
      console.error('[gateway] proxy error', err.message);
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Unable to reach the API. Please try again later.'
      });
    }
  });
}

// Microservice routes (override before monolith fallback)
app.use('/api/dashboard', buildProxy(REPORTING_SERVICE_URL, 'reporting'));
app.use('/api/reports', buildProxy(REPORTING_SERVICE_URL, 'reporting'));
app.use('/api/audit', buildProxy(REPORTING_SERVICE_URL, 'reporting'));
app.use('/api/scan-bridge', buildProxy(INTEGRATIONS_SERVICE_URL, 'integrations'));

// Fallback: proxy all /api/* calls to monolith
app.use('/api', buildProxy(TARGET_BACKEND_URL, 'backend'));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `FleetNeuron API Gateway listening on port ${PORT}, proxying /api to ${TARGET_BACKEND_URL}`
  );
});

