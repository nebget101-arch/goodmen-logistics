const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.dynatrace') });

// Debug: Print loaded Dynatrace environment variables
console.log('DYNATRACE_ENVIRONMENT_URL:', process.env.DYNATRACE_ENVIRONMENT_URL);
console.log('DYNATRACE_API_TOKEN:', process.env.DYNATRACE_API_TOKEN ? 'set' : 'not set');
console.log('DYNATRACE_ENABLED:', process.env.DYNATRACE_ENABLED);

const { sendTestMetricLine } = require('./config/dynatrace-sdk');
sendTestMetricLine();
// Initialize Dynatrace SDK (must be first)
const { 
  initializeDynatrace, 
  dynatraceMiddleware,
  sendLog 
} = require('./config/dynatrace-sdk');

// Initialize Dynatrace
initializeDynatrace();

const app = express();
const PORT = process.env.PORT || 3000;

// Test database connection on startup
const { pool } = require('./config/database');
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('💡 Run "npm run db:init" to initialize the database');
  } else {
    console.log('✅ Database connected successfully');
  }
});

// Middleware
app.use(cors());

// Dynatrace request tracking middleware (add before other routes)
app.use(dynatraceMiddleware);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import routes
const driversRouter = require('./routes/drivers');
const vehiclesRouter = require('./routes/vehicles');
const hosRouter = require('./routes/hos');
const maintenanceRouter = require('./routes/maintenance');
const drugAlcoholRouter = require('./routes/drug-alcohol');
const loadsRouter = require('./routes/loads');
const dashboardRouter = require('./routes/dashboard');
const auditRouter = require('./routes/audit');
const dbExampleRouter = require('./routes/db-example');
const dqfDocumentsRouter = require('./routes/dqf-documents');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const workOrdersRouter = require('./routes/work-orders');


const locationsRouter = require('./routes/locations');
const customersRouter = require('./routes/customers');

// Use routes

// Register customers API
const knex = require('knex')(require('./knexfile').development);
app.use('/api/customers', customersRouter(knex));
app.use('/api/users', usersRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/hos', hosRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/drug-alcohol', drugAlcoholRouter);
app.use('/api/loads', loadsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/audit', auditRouter);
app.use('/api/db-example', dbExampleRouter);
app.use('/api/dqf-documents', dqfDocumentsRouter);
app.use('/api/auth', authRouter);
app.use('/api/work-orders', workOrdersRouter);

// Health check
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    status: 'ok',
    message: 'Goodmen Logistics API is running',
    dynatrace: process.env.DYNATRACE_ENABLED === 'true' ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString()
  };
  
  // Track health check in Dynatrace
  await sendLog('INFO', 'Health check requested', healthStatus);
  
  res.json(healthStatus);
});

// Test error endpoint - generates various types of errors for testing
app.get('/api/test-error', (req, res) => {
  const errorType = req.query.type || 'generic';
  
  // Log the error
  const errorDetails = {
    type: errorType,
    timestamp: new Date().toISOString(),
    endpoint: '/api/test-error',
    requestId: Math.random().toString(36).substring(7)
  };
  
  dtLogger.error(`Test error generated: ${errorType}`, errorDetails);
  
  switch (errorType) {
    case 'database':
      dtLogger.error('Database connection failed', {
        ...errorDetails,
        error: 'ECONNREFUSED',
        host: '127.0.0.1',
        port: 5432
      });
      res.status(500).json({
        error: 'Database Error',
        message: 'Failed to connect to database',
        code: 'DB_CONNECTION_ERROR',
        details: errorDetails
      });
      break;
      
    case 'timeout':
      dtLogger.error('Request timeout', {
        ...errorDetails,
        timeout: 30000,
        endpoint: '/api/drivers'
      });
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'Request timeout after 30000ms',
        code: 'TIMEOUT_ERROR',
        details: errorDetails
      });
      break;
      
    case 'validation':
      dtLogger.error('Validation failed', {
        ...errorDetails,
        field: 'email',
        value: 'invalid-email'
      });
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid email format',
        code: 'VALIDATION_ERROR',
        details: errorDetails
      });
      break;
      
    case 'notfound':
      dtLogger.error('Resource not found', {
        ...errorDetails,
        resource: 'driver',
        id: '12345'
      });
      res.status(404).json({
        error: 'Not Found',
        message: 'Driver with ID 12345 not found',
        code: 'NOT_FOUND',
        details: errorDetails
      });
      break;
      
    case 'auth':
      dtLogger.error('Authentication failed', {
        ...errorDetails,
        reason: 'Invalid token'
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication failed - invalid token',
        code: 'AUTH_ERROR',
        details: errorDetails
      });
      break;
      
    default:
      dtLogger.error('Generic server error', errorDetails);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
        details: errorDetails
      });
  }
});

// Serve Angular frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist', 'goodmen-logistics');
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Start server
app.listen(PORT, async () => {
  console.log(`🚛 Goodmen Logistics Backend running on http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🗄️  Database Examples: http://localhost:${PORT}/api/db-example/drivers`);
  
  // Log startup event to Dynatrace
  await sendLog('INFO', 'Server started successfully', { port: PORT });
});
