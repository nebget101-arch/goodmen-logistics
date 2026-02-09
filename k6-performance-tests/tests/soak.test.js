/**
 * Soak Test - Test system under sustained load over extended period
 * 
 * Purpose: Identify memory leaks, resource exhaustion, degradation
 * VUs: 20
 * Duration: 1 hour+
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { config } from '../config/config.js';

// Parameterized configuration using environment variables
const VUS = parseInt(__ENV.SOAK_VUS || '20');
const DURATION = __ENV.SOAK_DURATION || '1h';

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
  tags: {
    test_type: 'soak',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  const endpoints = Object.values(config.endpoints);
  
  // Random endpoint selection to simulate real usage
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  
  const res = http.get(`${baseUrl}${endpoint}`);
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'no performance degradation': (r) => r.timings.duration < 1000,
  });
  
  sleep(Math.random() * 3 + 2); // 2-5 seconds think time
}

export function handleSummary(data) {
  return {
    'reports/soak-summary.json': JSON.stringify({
      testType: 'soak',
      timestamp: new Date().toISOString(),
      duration: data.state.testRunDurationMs,
      metrics: {
        totalRequests: data.metrics.http_reqs.values.count,
        errorRate: (data.metrics.http_req_failed.values.rate * 100).toFixed(2) + '%',
        avgDuration: data.metrics.http_req_duration.values.avg.toFixed(2) + 'ms',
        p95Duration: data.metrics.http_req_duration.values['p(95)'].toFixed(2) + 'ms',
        degradationDetected: detectDegradation(data),
      },
    }, null, 2),
  };
}

function detectDegradation(data) {
  const p95 = data.metrics.http_req_duration.values['p(95)'];
  return p95 > 800 ? 'Performance degradation detected' : 'No significant degradation';
}
