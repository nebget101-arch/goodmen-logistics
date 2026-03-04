require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

const PORT = process.env.PORT || 4000;
const TARGET_BACKEND_URL =
  process.env.TARGET_BACKEND_URL || 'http://localhost:3000';
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

// Proxy ALL /api/* calls directly to backend /api/*
// Express strips the /api prefix when mounting, so we rewrite path back to /api/...
app.use(
  '/api',
  createProxyMiddleware({
    target: TARGET_BACKEND_URL,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path) => '/api' + (path.startsWith('/') ? path : '/' + path),
    logLevel: isProd ? 'warn' : 'debug',
    onProxyReq: isProd
      ? undefined
      : (proxyReq, req) => {
          // eslint-disable-next-line no-console
          console.log(
            `[gateway->backend] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`
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
  })
);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `FleetNeuron API Gateway listening on port ${PORT}, proxying /api to ${TARGET_BACKEND_URL}`
  );
});

