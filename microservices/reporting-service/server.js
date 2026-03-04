require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const dashboardRouter = require('./routes/dashboard');
const reportsRouter = require('./routes/reports');
const auditRouter = require('./routes/audit');

app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/audit', auditRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-reporting-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`📊 Reporting service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Reporting service started successfully', { port: PORT });
});
