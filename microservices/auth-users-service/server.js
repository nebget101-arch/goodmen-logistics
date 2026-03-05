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
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const authRouter = require('@goodmen/shared/routes/auth');
const usersRouter = require('@goodmen/shared/routes/users');
const communicationPreferencesRouter = require('@goodmen/shared/routes/communication-preferences');

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
