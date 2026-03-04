require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5006;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const backendUploads = path.join(__dirname, '..', '..', 'goodmen-logistics', 'backend', 'uploads');
app.use('/uploads', express.static(backendUploads));

const loadsRouter = require('./routes/loads');
const brokersRouter = require('./routes/brokers');
const locationsRouter = require('./routes/locations');
const geoRouter = require('./routes/geo');
const invoicesRouter = require('./routes/invoices');
const creditRouter = require('./routes/credit');
const dbExampleRouter = require('./routes/db-example');

app.use('/api/loads', loadsRouter);
app.use('/api/brokers', brokersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/credit', creditRouter);
app.use('/api/db-example', dbExampleRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-logistics-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`🚚 Logistics service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Logistics service started successfully', { port: PORT });
});
