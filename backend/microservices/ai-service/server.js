require('./tracing');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');

const { buildAiRouter } = require('./src/ai-router');

const PORT = process.env.AI_SERVICE_PORT || 4100;

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:4200',
    credentials: true
  })
);

app.use(bodyParser.json({ limit: '20mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-service'
  });
});

app.use('/api/ai', buildAiRouter({ openai }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AI service listening on port ${PORT}`);
});

