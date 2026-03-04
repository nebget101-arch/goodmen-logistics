require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5004;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const driversRouter = require('./routes/drivers');
const dqfRouter = require('./routes/dqf');
const dqfDocumentsRouter = require('./routes/dqf-documents');
const hosRouter = require('./routes/hos');
const drugAlcoholRouter = require('./routes/drug-alcohol');
const onboardingRouter = require('./routes/onboarding');
const publicOnboardingRouter = require('./routes/public-onboarding');

app.use('/api/drivers', driversRouter);
app.use('/api/dqf', dqfRouter);
app.use('/api/dqf-documents', dqfDocumentsRouter);
app.use('/api/hos', hosRouter);
app.use('/api/drug-alcohol', drugAlcoholRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/public/onboarding', publicOnboardingRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-drivers-compliance-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`🧑‍✈️ Drivers compliance service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Drivers compliance service started successfully', { port: PORT });
});
