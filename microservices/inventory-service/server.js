require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5007;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const inventoryRouter = require('./routes/inventory');
const adjustmentsRouter = require('./routes/adjustments');
const cycleCountsRouter = require('./routes/cycle-counts');
const receivingRouter = require('./routes/receiving');
const barcodesRouter = require('./routes/barcodes');
const customersRouter = require('./routes/customers');
const customerBulkUploadRouter = require('./routes/customer-bulk-upload');

app.use('/api/inventory', inventoryRouter);
app.use('/api/adjustments', adjustmentsRouter);
app.use('/api/cycle-counts', cycleCountsRouter);
app.use('/api/receiving', receivingRouter);
app.use('/api/barcodes', barcodesRouter);
app.use('/api/customers', customerBulkUploadRouter);
app.use('/api/customers', customersRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-inventory-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`📦 Inventory service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Inventory service started successfully', { port: PORT });
});
