/**
 * Load Test - Test system under expected normal and peak load
 * 
 * Purpose: Assess system performance under normal and peak conditions
 * VUs: 10-50
 * Duration: 15-20m
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { config } from '../config/config.js';
import { makeRequest, thinkTime, generateDriverData, generateVehicleData } from '../utils/helpers.js';

// Parameterized configuration using environment variables
const RAMP_UP_TIME = __ENV.RAMP_UP_TIME || '2m';
const STEADY_TIME = __ENV.STEADY_TIME || '5m';
const TARGET_VU_1 = parseInt(__ENV.TARGET_VU_1 || '10');
const TARGET_VU_2 = parseInt(__ENV.TARGET_VU_2 || '20');
const TARGET_VU_3 = parseInt(__ENV.TARGET_VU_3 || '30');

export const options = {
  stages: [
    { duration: RAMP_UP_TIME, target: TARGET_VU_1 },  // Ramp up to first level
    { duration: STEADY_TIME, target: TARGET_VU_1 },   // Stay at first level
    { duration: RAMP_UP_TIME, target: TARGET_VU_2 },  // Ramp to second level
    { duration: STEADY_TIME, target: TARGET_VU_2 },   // Stay at second level
    { duration: RAMP_UP_TIME, target: TARGET_VU_3 },  // Ramp to third level
    { duration: STEADY_TIME, target: TARGET_VU_3 },   // Stay at third level
    { duration: RAMP_UP_TIME, target: 0 },            // Ramp down
  ],
  thresholds: config.thresholds,
  tags: {
    test_type: 'load',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  
  // Scenario 1: Read-heavy operations (70% of traffic)
  if (Math.random() < 0.7) {
    group('Read Operations', () => {
      // Dashboard view
      http.get(`${baseUrl}${config.endpoints.dashboard}`, {
        tags: { endpoint: 'dashboard', operation: 'read' },
      });
      thinkTime(2, 4);
      
      // View drivers
      http.get(`${baseUrl}${config.endpoints.drivers}`, {
        tags: { endpoint: 'drivers', operation: 'read' },
      });
      thinkTime(1, 3);
      
      // View vehicles
      http.get(`${baseUrl}${config.endpoints.vehicles}`, {
        tags: { endpoint: 'vehicles', operation: 'read' },
      });
      thinkTime(1, 3);
      
      // Check HOS records
      http.get(`${baseUrl}${config.endpoints.hos}`, {
        tags: { endpoint: 'hos', operation: 'read' },
      });
      thinkTime(2, 4);
    });
  } 
  // Scenario 2: Write operations (30% of traffic)
  else {
    group('Write Operations', () => {
      // Create driver
      const driverData = generateDriverData();
      const createRes = http.post(
        `${baseUrl}${config.endpoints.drivers}`,
        JSON.stringify(driverData),
        {
          headers: { 'Content-Type': 'application/json' },
          tags: { endpoint: 'drivers', operation: 'create' },
        }
      );
      
      check(createRes, {
        'driver created': (r) => r.status === 201,
      });
      
      thinkTime(2, 4);
      
      // View created driver if successful
      if (createRes.status === 201) {
        const driver = JSON.parse(createRes.body);
        http.get(`${baseUrl}${config.endpoints.drivers}/${driver.id}`, {
          tags: { endpoint: 'drivers', operation: 'read' },
        });
      }
    });
  }
  
  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    testType: 'load',
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    metrics: {
      totalRequests: data.metrics.http_reqs.values.count,
      failedRequests: data.metrics.http_req_failed.values.passes,
      errorRate: (data.metrics.http_req_failed.values.rate * 100).toFixed(2) + '%',
      avgDuration: data.metrics.http_req_duration.values.avg.toFixed(2) + 'ms',
      p50Duration: data.metrics.http_req_duration.values.med.toFixed(2) + 'ms',
      p95Duration: data.metrics.http_req_duration.values['p(95)'].toFixed(2) + 'ms',
      p99Duration: data.metrics.http_req_duration.values['p(99)'].toFixed(2) + 'ms',
      maxDuration: data.metrics.http_req_duration.values.max.toFixed(2) + 'ms',
      requestsPerSecond: data.metrics.http_reqs.values.rate.toFixed(2),
    },
    thresholds: data.thresholds,
  };
  
  return {
    'reports/load-summary.json': JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
