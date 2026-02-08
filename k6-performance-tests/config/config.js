// Performance Testing Configuration
export const config = {
  // Base URL for API under test
  baseUrl: __ENV.BASE_URL || 'https://safetyapp-ln58.onrender.com',
  
  // Performance thresholds - enterprise standards
  thresholds: {
    // 95% of requests should complete within 500ms
    http_req_duration: ['p(95)<500'],
    
    // 99% of requests should complete within 1000ms
    'http_req_duration{expected_response:true}': ['p(99)<1000'],
    
    // Error rate should be less than 1%
    http_req_failed: ['rate<0.01'],
    
    // 95% of requests should start receiving response within 200ms
    http_req_waiting: ['p(95)<200'],
    
    // Specific endpoint thresholds
    'http_req_duration{endpoint:drivers}': ['p(95)<400'],
    'http_req_duration{endpoint:vehicles}': ['p(95)<300'],
    'http_req_duration{endpoint:hos}': ['p(95)<500'],
    'http_req_duration{endpoint:loads}': ['p(95)<600'],
  },
  
  // Test scenarios configuration
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
    },
    
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 10 },  // Ramp up to 10 users
        { duration: '5m', target: 10 },  // Stay at 10 users
        { duration: '2m', target: 20 },  // Ramp up to 20 users
        { duration: '5m', target: 20 },  // Stay at 20 users
        { duration: '2m', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '30s',
    },
    
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 20 },   // Ramp up to 20 users
        { duration: '5m', target: 20 },   // Stay at 20
        { duration: '2m', target: 50 },   // Ramp up to 50
        { duration: '5m', target: 50 },   // Stay at 50
        { duration: '2m', target: 100 },  // Ramp up to 100
        { duration: '5m', target: 100 },  // Stay at 100
        { duration: '5m', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '1m',
    },
    
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },    // Normal load
        { duration: '10s', target: 100 },  // Spike to 100 users
        { duration: '3m', target: 100 },   // Maintain spike
        { duration: '10s', target: 5 },    // Return to normal
        { duration: '3m', target: 5 },     // Recover
        { duration: '10s', target: 0 },    // Ramp down
      ],
    },
    
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1h', // Run for 1 hour
    },
  },
  
  // API endpoints to test
  endpoints: {
    drivers: '/api/drivers',
    vehicles: '/api/vehicles',
    hos: '/api/hos',
    loads: '/api/loads',
    maintenance: '/api/maintenance',
    dashboard: '/api/dashboard/stats',
    audit: '/api/audit/trail',
    health: '/api/health',
  },
  
  // Expected response times (ms)
  expectedResponseTimes: {
    drivers: 300,
    vehicles: 250,
    hos: 400,
    loads: 500,
    maintenance: 350,
    dashboard: 600,
    audit: 300,
    health: 100,
  },
};

export default config;
