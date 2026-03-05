require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const dbConfig = require('@goodmen/shared/config/database');
const knex = require('@goodmen/shared/config/knex');
require('@goodmen/shared').setDatabase({
  pool: dbConfig.pool,
  query: dbConfig.query,
  getClient: dbConfig.getClient,
  knex
});

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const vehiclesRouter = require('@goodmen/shared/routes/vehicles');
const maintenanceRouter = require('@goodmen/shared/routes/maintenance');
const equipmentRouter = require('@goodmen/shared/routes/equipment');
const workOrdersRouter = require('@goodmen/shared/routes/work-orders-hub');
const partsRouter = require('@goodmen/shared/routes/parts');

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/parts', partsRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-vehicles-maintenance-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🛠️ Vehicles maintenance service running on http://localhost:${PORT}`);
});
