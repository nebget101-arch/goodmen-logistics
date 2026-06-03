'use strict';

// OpenTelemetry must be initialized BEFORE any other require.
// This file is required as the first line of server.js.
const path = require('path');
const initTracing = require(path.join(__dirname, '..', '..', 'packages', 'goodmen-shared', 'config', 'tracing'));

initTracing({ serviceName: 'fleetneuron-ai-service' });
