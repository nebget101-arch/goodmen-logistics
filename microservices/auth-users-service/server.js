require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { dynatraceMiddleware, sendLog } = require('./config/dynatrace-sdk');

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(dynatraceMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const communicationPreferencesRouter = require('./routes/communication-preferences');

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/communication-preferences', communicationPreferencesRouter);

app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-auth-users-service',
    timestamp: new Date().toISOString()
  };

  await sendLog('INFO', 'Health check requested', healthStatus);
  res.json(healthStatus);
});

app.listen(PORT, async () => {
  console.log(`🔐 Auth/Users service running on http://localhost:${PORT}`);
  await sendLog('INFO', 'Auth/Users service started successfully', { port: PORT });
});
