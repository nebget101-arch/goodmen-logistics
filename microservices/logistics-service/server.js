require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const dbConfig = require('./config/database');
const knex = require('./config/knex');
require('@goodmen/shared').setDatabase({
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

const loadsRouter = require('@goodmen/shared/routes/loads');
const brokersRouter = require('@goodmen/shared/routes/brokers');
const locationsRouter = require('@goodmen/shared/routes/locations');
const geoRouter = require('@goodmen/shared/routes/geo');
const invoicesRouter = require('@goodmen/shared/routes/invoices');
const creditRouter = require('@goodmen/shared/routes/credit');
const dbExampleRouter = require('@goodmen/shared/routes/db-example');

app.use('/api/loads', loadsRouter);
app.use('/api/brokers', brokersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/db-example', dbExampleRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-logistics-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🚚 Logistics service running on http://localhost:${PORT}`);
});
