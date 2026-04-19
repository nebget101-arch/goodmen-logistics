require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const swaggerUi = require('swagger-ui-express');

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

// ── Unified API Documentation ─────────────────────────────────────
// Aggregates OpenAPI specs from all downstream services into a single
// Swagger UI available at /api-docs on the gateway.
const SERVICE_SPECS = [
  { name: 'Auth & Users', url: AUTH_USERS_SERVICE_URL },
  { name: 'Logistics', url: LOGISTICS_SERVICE_URL },
  { name: 'Drivers Compliance', url: DRIVERS_COMPLIANCE_SERVICE_URL },
  { name: 'Vehicles & Maintenance', url: VEHICLES_MAINTENANCE_SERVICE_URL },
  { name: 'Inventory', url: INVENTORY_SERVICE_URL },
  { name: 'Reporting', url: REPORTING_SERVICE_URL },
  { name: 'Integrations', url: INTEGRATIONS_SERVICE_URL },
  { name: 'AI Service', url: AI_SERVICE_URL }
];

let cachedSpec = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchServiceSpec(serviceUrl) {
  const specUrl = `${serviceUrl.replace(/\/$/, '')}/api-docs-json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(specUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mergePaths(specs) {
  const merged = {};
  for (const spec of specs) {
    if (!spec || !spec.paths) continue;
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!merged[path]) {
        merged[path] = methods;
      } else {
        Object.assign(merged[path], methods);
      }
    }
  }
  return merged;
}

function mergeSchemas(specs) {
  const merged = {};
  for (const spec of specs) {
    if (!spec?.components?.schemas) continue;
    Object.assign(merged, spec.components.schemas);
  }
  return merged;
}

function collectTags(specs) {
  const tagSet = new Set();
  for (const spec of specs) {
    if (!spec?.paths) continue;
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        if (op?.tags) {
          op.tags.forEach((t) => tagSet.add(t));
        }
      }
    }
  }
  return Array.from(tagSet)
    .sort()
    .map((name) => ({ name }));
}

async function getAggregatedSpec() {
  const now = Date.now();
  if (cachedSpec && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSpec;
  }

  const results = await Promise.all(
    SERVICE_SPECS.map((s) => fetchServiceSpec(s.url))
  );
  const validSpecs = results.filter(Boolean);

  const gatewayUrl =
    process.env.NODE_ENV === 'production'
      ? 'https://fleetneuron-logistics-gateway.onrender.com'
      : isProd
        ? 'https://fleetneuron-logistics-gateway.onrender.com'
        : `http://localhost:${PORT}`;

  cachedSpec = {
    openapi: '3.0.0',
    info: {
      title: 'FleetNeuron API — Unified Documentation',
      version: '2.0.0',
      description: `AI-powered fleet management platform API. Aggregated from ${validSpecs.length}/${SERVICE_SPECS.length} services.`,
      contact: { name: 'FleetNeuron', url: 'https://fleetneuron.ai' }
    },
    servers: [
      { url: gatewayUrl, description: isProd ? 'Production' : 'Current' },
      {
        url: 'https://fleetneuron-logistics-gateway-dev.onrender.com',
        description: 'Dev'
      },
      {
        url: 'https://fleetneuron-logistics-gateway.onrender.com',
        description: 'Production'
      }
    ],
    tags: collectTags(validSpecs),
    paths: mergePaths(validSpecs),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: mergeSchemas(validSpecs)
    },
    security: [{ bearerAuth: [] }]
  };
  cacheTimestamp = now;
  return cachedSpec;
}

// Serve raw JSON spec (used by other services and swagger:export)
app.get('/api-docs-json', async (_req, res) => {
  try {
    const spec = await getAggregatedSpec();
    res.json(spec);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[gateway] Failed to aggregate specs:', err.message);
    res.status(500).json({ error: 'Failed to aggregate API specs' });
  }
});

// Serve Swagger UI
app.use(
  '/api-docs',
  swaggerUi.serve,
  async (req, res, next) => {
    try {
      const spec = await getAggregatedSpec();
      return swaggerUi.setup(spec, {
        customSiteTitle: 'FleetNeuron API Docs',
        customCss: '.swagger-ui .topbar { display: none }'
      })(req, res, next);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[gateway] Swagger UI error:', err.message);
      return res.status(500).send('Failed to load API documentation');
    }
  }
);

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
    onProxyReq: (proxyReq, req) => {
      // Forward W3C trace context headers for distributed tracing (OpenTelemetry).
      // http-proxy-middleware forwards most headers, but explicitly ensuring
      // traceparent/tracestate survive guarantees end-to-end trace linkage.
      const traceparent = req.headers['traceparent'];
      const tracestate = req.headers['tracestate'];
      if (traceparent) proxyReq.setHeader('traceparent', traceparent);
      if (tracestate) proxyReq.setHeader('tracestate', tracestate);

      if (!isProd) {
        // eslint-disable-next-line no-console
        console.log(
          `[gateway->${label}] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`
        );
      }
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
    proxyTimeout: 55000,
    onError: (err, req, res) => {
      // eslint-disable-next-line no-console
      console.error('[gateway] proxy error', err.message);
      if (res.headersSent) return;
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
app.use('/api/webhooks/email-inbound', buildProxy(INTEGRATIONS_SERVICE_URL, 'integrations'));
app.use('/api/tenants/me/inbound-email', buildProxy(INTEGRATIONS_SERVICE_URL, 'integrations'));
app.use('/api/auth', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/stripe', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/users', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/roles', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/permissions', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use(
  '/api/communication-preferences',
  buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users')
);
app.use('/api/billing', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
app.use('/api/contact', buildProxy(AUTH_USERS_SERVICE_URL, 'auth-users'));
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
app.use('/api/consents', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/employer-investigations', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/annual-compliance', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use('/api/address', buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers'));
app.use(
  '/public/onboarding',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/public/roadside',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/public/consents',
  buildProxy(DRIVERS_COMPLIANCE_SERVICE_URL, 'drivers')
);
app.use(
  '/public/employer-investigations',
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
app.use('/api/load-templates', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
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
app.use('/api/idle-truck-monitor', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
app.use('/api/notifications', buildProxy(LOGISTICS_SERVICE_URL, 'logistics'));
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

