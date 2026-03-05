require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5004;

app.use(cors());
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

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-drivers-compliance-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🧑‍✈️ Drivers compliance service running on http://localhost:${PORT}`);
});
