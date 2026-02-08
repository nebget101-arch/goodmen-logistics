import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const apiDuration = new Trend('api_duration');
export const apiCalls = new Counter('api_calls');
export const activeUsers = new Gauge('active_users');

/**
 * Make an API request with automatic error tracking and tagging
 */
export function makeRequest(http, url, options = {}) {
  const tags = options.tags || {};
  const response = http.get(url, { tags });
  
  // Track metrics
  errorRate.add(response.status !== 200);
  apiDuration.add(response.timings.duration);
  apiCalls.add(1);
  
  // Basic validation
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });
  
  return { response, success };
}

/**
 * Think time - simulate user reading/thinking
 */
export function thinkTime(min = 1, max = 3) {
  sleep(Math.random() * (max - min) + min);
}

/**
 * Generate realistic test data using patterns
 * Note: K6 doesn't support npm imports, so we use simple randomization
 * For cleanup, we tag data with TEST_DATA_ prefix
 */

const TEST_DATA_PREFIX = 'TEST_DATA_';

// Random helpers
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function randomString(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Data generators
const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Christopher', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Nancy'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
const cities = ['Los Angeles', 'San Francisco', 'San Diego', 'Sacramento', 'Oakland', 'Fresno', 'Long Beach', 'Bakersfield'];
const states = ['CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
const truckMakes = ['Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'International', 'Mack'];
const truckModels = ['Cascadia', 'T680', 'W900', 'VNL', 'LT', 'Anthem'];

export function generateDriverData() {
  const timestamp = Date.now();
  const random = randomInt(1000, 9999);
  const firstName = randomElement(firstNames);
  const lastName = randomElement(lastNames);
  
  return {
    firstName: `${TEST_DATA_PREFIX}${firstName}`,
    lastName: lastName,
    email: `${TEST_DATA_PREFIX.toLowerCase()}${firstName.toLowerCase()}.${lastName.toLowerCase()}${random}@testdriver.com`,
    phone: `555-${randomInt(100, 999)}-${randomInt(1000, 9999)}`,
    cdlNumber: `${TEST_DATA_PREFIX}CDL${randomString(8)}`,
    cdlState: randomElement(states),
    cdlClass: randomElement(['A', 'B', 'C']),
    address: `${randomInt(100, 9999)} ${randomElement(['Main', 'Oak', 'Maple', 'Cedar', 'Elm'])} St, ${randomElement(cities)}, ${randomElement(states)} ${randomInt(90000, 99999)}`,
  };
}

export function generateVehicleData() {
  const timestamp = Date.now();
  const random = randomInt(1000, 9999);
  
  return {
    unit: `${TEST_DATA_PREFIX}T${random}`,
    make: randomElement(truckMakes),
    model: randomElement(truckModels),
    year: randomInt(2018, 2024),
    vin: `${TEST_DATA_PREFIX}${randomString(17)}`,
    licensePlate: `${TEST_DATA_PREFIX}${randomString(7)}`,
    licensePlateState: randomElement(states),
  };
}

/**
 * Generate HOS (Hours of Service) test data
 */
export function generateHOSData(driverId) {
  const statuses = ['ON_DUTY', 'OFF_DUTY', 'DRIVING', 'SLEEPER_BERTH'];
  const now = new Date();
  
  return {
    driverId: driverId,
    status: randomElement(statuses),
    startTime: new Date(now.getTime() - randomInt(1, 12) * 3600000).toISOString(),
    endTime: now.toISOString(),
    location: `${randomElement(cities)}, ${randomElement(states)}`,
    notes: `${TEST_DATA_PREFIX}Automated test entry`,
  };
}

/**
 * Get test data identifier for cleanup
 */
export function getTestDataPrefix() {
  return TEST_DATA_PREFIX;
}

/**
 * Format metrics for reporting
 */
export function formatMetrics(data) {
  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalRequests: data.metrics.http_reqs.values.count,
      failedRequests: data.metrics.http_req_failed.values.passes,
      avgDuration: data.metrics.http_req_duration.values.avg,
      p95Duration: data.metrics.http_req_duration.values['p(95)'],
      p99Duration: data.metrics.http_req_duration.values['p(99)'],
      minDuration: data.metrics.http_req_duration.values.min,
      maxDuration: data.metrics.http_req_duration.values.max,
      errorRate: data.metrics.http_req_failed.values.rate * 100,
      requestsPerSecond: data.metrics.http_reqs.values.rate,
    },
    thresholds: data.thresholds,
  };
}

/**
 * Create performance test scenario
 */
export function createScenario(name, testFunction, options = {}) {
  return {
    name,
    exec: testFunction,
    ...options,
  };
}

/**
 * Validate API response structure
 */
export function validateResponse(response, expectedFields = []) {
  const checks = {
    'status is 200': (r) => r.status === 200,
    'has json content-type': (r) => r.headers['Content-Type']?.includes('application/json'),
    'response body exists': (r) => r.body && r.body.length > 0,
  };
  
  // Add field validations
  if (expectedFields.length > 0) {
    const body = JSON.parse(response.body);
    expectedFields.forEach(field => {
      checks[`has field: ${field}`] = () => body.hasOwnProperty(field);
    });
  }
  
  return check(response, checks);
}
