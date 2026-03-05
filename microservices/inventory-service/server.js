require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const dbConfig = require('./config/database');
const knex = require('./config/knex');
require('@goodmen/shared').setDatabase({
  pool: dbConfig.pool,
  query: dbConfig.query,
  getClient: dbConfig.getClient,
  knex
});

const app = express();
const PORT = process.env.PORT || 5007;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const inventoryRouter = require('@goodmen/shared/routes/inventory');
const adjustmentsRouter = require('@goodmen/shared/routes/adjustments');
const cycleCountsRouter = require('@goodmen/shared/routes/cycle-counts');
const receivingRouter = require('@goodmen/shared/routes/receiving');
const barcodesRouter = require('@goodmen/shared/routes/barcodes');
const customersRouter = require('@goodmen/shared/routes/customers');
const customerBulkUploadRouter = require('@goodmen/shared/routes/customer-bulk-upload');

app.use('/api/inventory', inventoryRouter);
app.use('/api/adjustments', adjustmentsRouter);
app.use('/api/cycle-counts', cycleCountsRouter);
app.use('/api/receiving', receivingRouter);
app.use('/api/barcodes', barcodesRouter);
app.use('/api/customers', customerBulkUploadRouter);
app.use('/api/customers', customersRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-inventory-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`📦 Inventory service running on http://localhost:${PORT}`);
});
