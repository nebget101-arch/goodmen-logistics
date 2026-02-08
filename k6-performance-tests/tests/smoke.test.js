/**
 * Smoke Test - Minimal load test to verify basic functionality
 * 
 * Purpose: Quick sanity check before running larger tests
 * VUs: 1-2
 * Duration: 30s - 1m
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { config } from '../config/config.js';
import { makeRequest, thinkTime, validateResponse } from '../utils/helpers.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
  tags: {
    test_type: 'smoke',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  
  group('Health Check', () => {
    const res = http.get(`${baseUrl}/api/health`);
    check(res, {
      'health check is 200': (r) => r.status === 200,
      'health check responds quickly': (r) => r.timings.duration < 200,
    });
  });
  
  group('Driver Operations', () => {
    const res = http.get(`${baseUrl}${config.endpoints.drivers}`, {
      tags: { endpoint: 'drivers' },
    });
    validateResponse(res);
    thinkTime(1, 2);
  });
  
  group('Vehicle Operations', () => {
    const res = http.get(`${baseUrl}${config.endpoints.vehicles}`, {
      tags: { endpoint: 'vehicles' },
    });
    validateResponse(res);
    thinkTime(1, 2);
  });
  
  group('HOS Operations', () => {
    const res = http.get(`${baseUrl}${config.endpoints.hos}`, {
      tags: { endpoint: 'hos' },
    });
    validateResponse(res);
    thinkTime(1, 2);
  });
  
  sleep(1);
}

export function handleSummary(data) {
  return {
    'reports/smoke-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  let summary = '\n' + indent + '✓ Smoke Test Summary\n';
  summary += indent + '═'.repeat(50) + '\n';
  summary += indent + `Duration: ${data.state.testRunDurationMs}ms\n`;
  summary += indent + `Requests: ${data.metrics.http_reqs.values.count}\n`;
  summary += indent + `Failed: ${data.metrics.http_req_failed.values.passes}\n`;
  summary += indent + `Avg Duration: ${data.metrics.http_req_duration.values.avg.toFixed(2)}ms\n`;
  summary += indent + `P95 Duration: ${data.metrics.http_req_duration.values['p(95)'].toFixed(2)}ms\n`;
  return summary;
}
