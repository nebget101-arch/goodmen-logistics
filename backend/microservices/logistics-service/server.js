require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const sharedRoot = path.join(__dirname, '..', '..', 'packages', 'goodmen-shared');

const dbConfig = require(path.join(sharedRoot, 'config', 'database'));
const knex = require(path.join(sharedRoot, 'config', 'knex'));
require(sharedRoot).setDatabase({
  pool: dbConfig.pool,
  query: dbConfig.query,
  getClient: dbConfig.getClient,
  knex
});

const app = express();
const PORT = process.env.PORT || 5006;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const uploadsPath = path.join(__dirname, '..', '..', 'goodmen-logistics', 'backend', 'uploads');
app.use('/uploads', express.static(uploadsPath));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Logistics Service API',
      version: '1.0.0',
      description: 'API documentation for the Logistics microservice.'
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
    path.join(__dirname, '../../packages/goodmen-shared/routes/*.js'),
    __filename
  ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

const loadsRouter = require(path.join(sharedRoot, 'routes', 'loads'));
const brokersRouter = require(path.join(sharedRoot, 'routes', 'brokers'));
const locationsRouter = require(path.join(sharedRoot, 'routes', 'locations'));
const geoRouter = require(path.join(sharedRoot, 'routes', 'geo'));
const invoicesRouter = require(path.join(sharedRoot, 'routes', 'invoices'));
const creditRouter = require(path.join(sharedRoot, 'routes', 'credit'));
const dbExampleRouter = require(path.join(sharedRoot, 'routes', 'db-example'));
const settlementsRouter = require(path.join(sharedRoot, 'routes', 'settlements'));
const expensePaymentCategoriesRouter = require(path.join(sharedRoot, 'routes', 'expense-payment-categories'));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/loads', loadsRouter);
app.use('/api/brokers', brokersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/db-example', dbExampleRouter);
app.use('/api/settlements', settlementsRouter);
app.use('/api/expense-payment-categories', expensePaymentCategoriesRouter);

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
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-logistics-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

/**
 * @openapi
 * /health/db:
 *   get:
 *     summary: DB health and loads count (for debugging which DB the service uses)
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: DB info and loads count
 *       500:
 *         description: DB error
 */
app.get('/health/db', async (req, res) => {
  try {
    const dbResult = await dbConfig.query('SELECT current_database() AS name');
    const countResult = await dbConfig.query('SELECT COUNT(*) AS count FROM loads');
    const dbName = (dbResult.rows && dbResult.rows[0] && dbResult.rows[0].name) || null;
    const loadsCount = (countResult.rows && countResult.rows[0] && countResult.rows[0].count) != null
      ? parseInt(String(countResult.rows[0].count), 10)
      : null;
    res.json({
      status: 'ok',
      service: 'goodmen-logistics-service',
      database: dbName,
      loadsCount,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      service: 'goodmen-logistics-service',
      error: err.message || String(err),
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @openapi
 * /health/db/diagnostic:
 *   get:
 *     summary: Full DB diagnostic for troubleshooting empty loads (schema, table counts, list-query dry run)
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Diagnostic result
 *       500:
 *         description: DB error
 */
app.get('/health/db/diagnostic', async (req, res) => {
  const out = {
    status: 'ok',
    service: 'goodmen-logistics-service',
    database: null,
    search_path: null,
    tables: {},
    listQueryDryRun: null,
    timestamp: new Date().toISOString()
  };
  try {
    const dbResult = await dbConfig.query('SELECT current_database() AS name');
    out.database = (dbResult.rows && dbResult.rows[0] && dbResult.rows[0].name) || null;

    const pathResult = await dbConfig.query('SHOW search_path');
    out.search_path = (pathResult.rows && pathResult.rows[0] && pathResult.rows[0].search_path) || null;

    const tableNames = ['loads', 'load_stops', 'drivers', 'brokers', 'load_attachments'];
    const tablesResult = await dbConfig.query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
       AND table_name = ANY($1::text[])`,
      [tableNames]
    );
    const existing = (tablesResult.rows || []).reduce((acc, r) => {
      const name = r.table_name;
      if (!acc[name]) acc[name] = [];
      acc[name].push(r.table_schema);
      return acc;
    }, {});

    for (const table of tableNames) {
      const schemas = existing[table];
      out.tables[table] = {
        exists: Array.isArray(schemas) && schemas.length > 0,
        schemas: schemas || []
      };
      if (out.tables[table].exists) {
        try {
          const countResult = await dbConfig.query(`SELECT COUNT(*) AS count FROM ${table}`);
          const count = (countResult.rows && countResult.rows[0] && countResult.rows[0].count) != null
            ? parseInt(String(countResult.rows[0].count), 10)
            : null;
          out.tables[table].count = count;
        } catch (e) {
          out.tables[table].countError = e.message || String(e);
        }
      }
    }

    // Dry-run the same FROM clause the list endpoint uses (no auth), to see the exact error if it fails
    try {
      const dryRunSql = `
        SELECT COUNT(*) AS total
        FROM loads l
        LEFT JOIN drivers d ON l.driver_id = d.id
        LEFT JOIN brokers b ON l.broker_id = b.id
        LEFT JOIN LATERAL (
          SELECT city, state, zip, stop_date FROM load_stops
          WHERE load_id = l.id AND stop_type = 'PICKUP' ORDER BY sequence ASC LIMIT 1
        ) pickup ON true
        LEFT JOIN LATERAL (
          SELECT city, state, zip, stop_date FROM load_stops
          WHERE load_id = l.id AND stop_type = 'DELIVERY' ORDER BY sequence DESC LIMIT 1
        ) delivery ON true
        LEFT JOIN (
          SELECT load_id, COUNT(*) AS attachment_count, array_agg(DISTINCT type) AS attachment_types
          FROM load_attachments GROUP BY load_id
        ) att ON att.load_id = l.id
      `;
      const dryResult = await dbConfig.query(dryRunSql);
      const total = (dryResult.rows && dryResult.rows[0] && dryResult.rows[0].total) != null
        ? parseInt(String(dryResult.rows[0].total), 10)
        : null;
      out.listQueryDryRun = { success: true, total };
    } catch (e) {
      out.listQueryDryRun = { success: false, error: e.message || String(e), code: e.code || null };
    }

    res.json(out);
  } catch (err) {
    res.status(500).json({
      status: 'error',
      service: 'goodmen-logistics-service',
      error: err.message || String(err),
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚚 Logistics service running on http://localhost:${PORT}`);
});
