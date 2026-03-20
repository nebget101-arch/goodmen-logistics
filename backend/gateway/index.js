require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const stripeWebhookRouter = require('./routes/stripe');

const app = express();

const PORT = process.env.PORT || 4000;

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

const REPORTING_SERVICE_URL = requireEnv('REPORTING_SERVICE_URL');
const INTEGRATIONS_SERVICE_URL = requireEnv('INTEGRATIONS_SERVICE_URL');
const AUTH_USERS_SERVICE_URL = requireEnv('AUTH_USERS_SERVICE_URL');
const DRIVERS_COMPLIANCE_SERVICE_URL = requireEnv('DRIVERS_COMPLIANCE_SERVICE_URL');
const VEHICLES_MAINTENANCE_SERVICE_URL = requireEnv('VEHICLES_MAINTENANCE_SERVICE_URL');
const LOGISTICS_SERVICE_URL = requireEnv('LOGISTICS_SERVICE_URL');
const INVENTORY_SERVICE_URL = requireEnv('INVENTORY_SERVICE_URL');
const AI_SERVICE_URL = requireEnv('AI_SERVICE_URL');
const isProd = process.env.NODE_ENV === 'production';

function parseAllowedOrigins(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const baseAllowedOrigins = [
  'http://localhost:4200',
  'https://fleetneuron.ai',
  'https://dev.fleetneuron.ai',
  'https://fleetneuron-logistics-ui.onrender.com'
];

const allowedOrigins = Array.from(
  new Set([
    ...baseAllowedOrigins,
    ...parseAllowedOrigins(process.env.CORS_ORIGIN)
  ])
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
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
    target: {
      authUsers: AUTH_USERS_SERVICE_URL,
      reporting: REPORTING_SERVICE_URL,
      integrations: INTEGRATIONS_SERVICE_URL
    }
  });
});

// Stripe webhook endpoint must use raw request body for signature verification.
app.use('/api/stripe', stripeWebhookRouter);

function buildProxy(target, label) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path, req) => {
      const baseUrl = req.baseUrl || '';
      const fullPath = `${baseUrl}${path}`;
      if (fullPath.startsWith('/api') || fullPath.startsWith('/public')) {
        return fullPath;
      }
      return '/api' + (fullPath.startsWith('/') ? fullPath : '/' + fullPath);
    },
    logLevel: isProd ? 'warn' : 'debug',
    onProxyReq: isProd
      ? undefined
      : (proxyReq, req) => {
          // eslint-disable-next-line no-console
          console.log(
            `[gateway->${label}] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`
          );
        },
    onProxyRes: (proxyRes, req) => {
      const requestOrigin = req.headers.origin;
      if (!requestOrigin) {
        return;
      }

      if (!allowedOrigins.includes(requestOrigin)) {
        return;
      }

      // Some downstream services return `Access-Control-Allow-Origin: *`.
      // That breaks credentialed browser requests. Enforce gateway policy.
      proxyRes.headers['access-control-allow-origin'] = requestOrigin;
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      proxyRes.headers.vary = proxyRes.headers.vary
        ? `${proxyRes.headers.vary}, Origin`
        : 'Origin';
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
app.use('/api/fmcsa', buildProxy(INTEGRATIONS_SERVICE_URL, 'integrations'));
app.use('/api/auth', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/users', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/roles', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/permissions', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use(
  '/api/communication-preferences',
  buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users')
);
app.use('/api/billing', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
// Explicit trial-request mapping to avoid mount-path rewrite ambiguity for nested /api/public paths.
app.use(
  '/api/public/trial-requests',
  createProxyMiddleware({
    target: AUTH_USERS_SERVICE_URL,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: (path) => `/api/public/trial-requests${path}`,
    logLevel: isProd ? 'warn' : 'debug',
    onError: (err, req, res) => {
      // eslint-disable-next-line no-console
      console.error('[gateway] trial-requests proxy error', err.message);
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Unable to reach trial request API. Please try again later.'
      });
    }
  })
);
// Public marketing endpoints (trial requests, plan metadata)
app.use('/api/public', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/drivers', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/dqf', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use(
  '/api/dqf-documents',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use('/api/hos', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use(
  '/api/drug-alcohol',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/api/onboarding',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use('/api/employment', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/roadside', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/safety', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use(
  '/public/onboarding',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/public/roadside',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/api/vehicles',
  buildProxy(VEHICLES_MAINTENANCE_SERVICE_URL, 'vehicles')
);
app.use(
  '/api/maintenance',
  buildProxy(VEHICLES_MAINTENANCE_SERVICE_URL, 'vehicles')
);
app.use(
  '/api/equipment',
  buildProxy(VEHICLES_MAINTENANCE_SERVICE_URL, 'vehicles')
);
app.use(
  '/api/work-orders',
  buildProxy(VEHICLES_MAINTENANCE_SERVICE_URL, 'vehicles')
);
app.use('/api/parts', buildProxy(VEHICLES_MAINTENANCE_SERVICE_URL, 'vehicles'));
// Proxy /api/health, /api/health/db, /api/health/db/diagnostic to logistics (path can be /db when mounted)
app.use(
  '/api/health',
  createProxyMiddleware({
    target: LOGISTICS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      const full = (req.originalUrl || req.url || path).split('?')[0];
      return full.replace(/^\/api\/health/, '/health') || '/health';
    },
    logLevel: isProd ? 'warn' : 'debug',
    onError: (err, req, res) => {
      // eslint-disable-next-line no-console
      console.error('[gateway] logistics health proxy error', err.message);
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Unable to reach logistics service.'
      });
    }
  })
);
app.use('/api/fuel', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/tolls', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/lease-agreements', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/lease-financing', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/ifta', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/loads', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/brokers', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/locations', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/geo', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/invoices', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/credit', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/db-example', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/settlements', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/expense-payment-categories', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/expense-categories', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/reference', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/inventory', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/adjustments', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/cycle-counts', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/receiving', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/barcodes', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/shop-clients', buildProxy(INVENTORY_SERVICE_URL, 'inventory'));
app.use('/api/ai', buildProxy(AI_SERVICE_URL, 'ai'));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `FleetNeuron API Gateway listening on port ${PORT}`
  );
});

