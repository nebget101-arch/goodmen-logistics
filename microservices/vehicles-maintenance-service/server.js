require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const vehiclesRouter = require('./routes/vehicles');
const maintenanceRouter = require('./routes/maintenance');
const equipmentRouter = require('./routes/equipment');
const workOrdersRouter = require('./routes/work-orders-hub');
const partsRouter = require('./routes/parts');

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/equipment', equipmentRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/parts', partsRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-vehicles-maintenance-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`🛠️ Vehicles maintenance service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Vehicles maintenance service started successfully', { port: PORT });
});
