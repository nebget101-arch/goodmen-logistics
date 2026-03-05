require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const communicationPreferencesRouter = require('./routes/communication-preferences');

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/communication-preferences', communicationPreferencesRouter);

app.get('/health', (req, res) => {
  const healthStatus = {
    status: 'ok',
    service: 'goodmen-auth-users-service',
    timestamp: new Date().toISOString()
  };
  res.json(healthStatus);
});

app.listen(PORT, () => {
  console.log(`🔐 Auth/Users service running on http://localhost:${PORT}`);
});
