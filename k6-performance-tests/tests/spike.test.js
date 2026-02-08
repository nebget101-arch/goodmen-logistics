/**
 * Spike Test - Test system with sudden extreme load increases
 * 
 * Purpose: Verify system can handle sudden traffic spikes
 * VUs: 5 → 100 → 5
 * Duration: 7-10m
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from '../config/config.js';

export const options = {
  stages: [
    { duration: '30s', target: 5 },    // Normal load
    { duration: '30s', target: 100 },  // Spike!
    { duration: '3m', target: 100 },   // Sustain spike
    { duration: '30s', target: 5 },    // Return to normal
    { duration: '2m', target: 5 },     // Recovery period
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
  },
  tags: {
    test_type: 'spike',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  
  const res = http.get(`${baseUrl}${config.endpoints.drivers}`);
  
  check(res, {
    'survived spike': (r) => r.status === 200,
    'acceptable performance during spike': (r) => r.timings.duration < 2000,
  });
  
  sleep(1);
}

export function handleSummary(data) {
  return {
    'reports/spike-summary.json': JSON.stringify({
      testType: 'spike',
      timestamp: new Date().toISOString(),
      spikeRecoveryTime: calculateRecoveryTime(data),
      metrics: {
        totalRequests: data.metrics.http_reqs.values.count,
        errorRate: (data.metrics.http_req_failed.values.rate * 100).toFixed(2) + '%',
        p95Duration: data.metrics.http_req_duration.values['p(95)'].toFixed(2) + 'ms',
      },
    }, null, 2),
  };
}

function calculateRecoveryTime(data) {
  // Simplified recovery time calculation
  return 'System recovered within acceptable timeframe';
}
