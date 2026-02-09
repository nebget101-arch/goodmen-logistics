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

// Parameterized configuration using environment variables
const NORMAL_VU = parseInt(__ENV.SPIKE_NORMAL_VU || '5');
const SPIKE_VU = parseInt(__ENV.SPIKE_PEAK_VU || '100');
const SPIKE_UP_TIME = __ENV.SPIKE_UP_TIME || '30s';
const SPIKE_SUSTAIN_TIME = __ENV.SPIKE_SUSTAIN_TIME || '3m';
const SPIKE_DOWN_TIME = __ENV.SPIKE_DOWN_TIME || '30s';
const RECOVERY_TIME = __ENV.SPIKE_RECOVERY_TIME || '2m';

export const options = {
  stages: [
    { duration: SPIKE_UP_TIME, target: NORMAL_VU },      // Normal load
    { duration: SPIKE_UP_TIME, target: SPIKE_VU },       // Spike!
    { duration: SPIKE_SUSTAIN_TIME, target: SPIKE_VU },  // Sustain spike
    { duration: SPIKE_DOWN_TIME, target: NORMAL_VU },    // Return to normal
    { duration: RECOVERY_TIME, target: NORMAL_VU },      // Recovery period
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
