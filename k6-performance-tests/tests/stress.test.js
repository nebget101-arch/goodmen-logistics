/**
 * Stress Test - Test system beyond normal load to find breaking point
 * 
 * Purpose: Identify system limits and failure points
 * VUs: 20-100+
 * Duration: 20-30m
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { config } from '../config/config.js';

export const options = {
  stages: [
    { duration: '2m', target: 20 },   // Normal load
    { duration: '5m', target: 20 },   
    { duration: '2m', target: 50 },   // Above normal
    { duration: '5m', target: 50 },   
    { duration: '2m', target: 100 },  // Stress level
    { duration: '5m', target: 100 },  
    { duration: '2m', target: 150 },  // Breaking point
    { duration: '5m', target: 150 },  
    { duration: '5m', target: 0 },    // Recovery
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'], // Allow higher error rate
    http_req_duration: ['p(95)<2000'], // More lenient thresholds
  },
  tags: {
    test_type: 'stress',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  
  group('Stress - All Endpoints', () => {
    const endpoints = Object.values(config.endpoints);
    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    
    const res = http.get(`${baseUrl}${randomEndpoint}`, {
      tags: { test_type: 'stress' },
    });
    
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time acceptable under stress': (r) => r.timings.duration < 3000,
    });
  });
  
  sleep(Math.random() * 2);
}

export function handleSummary(data) {
  const summary = {
    testType: 'stress',
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    metrics: {
      totalRequests: data.metrics.http_reqs.values.count,
      failedRequests: data.metrics.http_req_failed.values.passes,
      errorRate: (data.metrics.http_req_failed.values.rate * 100).toFixed(2) + '%',
      avgDuration: data.metrics.http_req_duration.values.avg.toFixed(2) + 'ms',
      p95Duration: data.metrics.http_req_duration.values['p(95)'].toFixed(2) + 'ms',
      p99Duration: data.metrics.http_req_duration.values['p(99)'].toFixed(2) + 'ms',
      maxDuration: data.metrics.http_req_duration.values.max.toFixed(2) + 'ms',
      requestsPerSecond: data.metrics.http_reqs.values.rate.toFixed(2),
    },
    thresholds: data.thresholds,
    breakingPoint: identifyBreakingPoint(data),
  };
  
  return {
    'reports/stress-summary.json': JSON.stringify(summary, null, 2),
  };
}

function identifyBreakingPoint(data) {
  const errorRate = data.metrics.http_req_failed.values.rate;
  if (errorRate > 0.1) {
    return 'System reached breaking point - error rate exceeded 10%';
  } else if (errorRate > 0.05) {
    return 'System under severe stress - error rate 5-10%';
  } else {
    return 'System handled stress well - error rate below 5%';
  }
}
