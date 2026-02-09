/**
 * Vehicles API - Performance Tests
 * 
 * Purpose: Test vehicle endpoints with inspection_expiry and vehicle_documents
 * Focus: CRUD operations, sorting, filtering, and document management
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { config } from '../config/config.js';
import { makeRequest, thinkTime, validateResponse } from '../utils/helpers.js';

// Parameterized configuration using environment variables
const RAMP_UP_TIME = __ENV.VEHICLES_RAMP_UP || '30s';
const STEADY_TIME = __ENV.VEHICLES_STEADY || '1m';
const RAMP_DOWN_TIME = __ENV.VEHICLES_RAMP_DOWN || '20s';
const TARGET_VU = parseInt(__ENV.VEHICLES_TARGET_VU || '10');

export const options = {
  stages: [
    { duration: RAMP_UP_TIME, target: TARGET_VU },   // Ramp up
    { duration: STEADY_TIME, target: TARGET_VU },    // Steady state
    { duration: RAMP_DOWN_TIME, target: 0 },         // Ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    'http_req_duration{endpoint:vehicles}': ['p(95)<1500'],
    'http_req_duration{endpoint:vehicle_documents}': ['p(95)<1000'],
  },
  tags: {
    test_type: 'vehicles_load',
  },
};

export default function () {
  const baseUrl = config.baseUrl;
  const headers = { 'Content-Type': 'application/json' };
  
  let vehicleId, documentId;
  
  group('Vehicle List Operations', () => {
    // Get all vehicles
    const res = http.get(`${baseUrl}/api/vehicles`, {
      tags: { endpoint: 'vehicles', operation: 'list' },
    });
    
    check(res, {
      'vehicles list returns 200': (r) => r.status === 200,
      'response is array': (r) => Array.isArray(JSON.parse(r.body)),
      'vehicles have inspection_expiry': (r) => {
        const vehicles = JSON.parse(r.body);
        return vehicles.length > 0 && vehicles.some(v => 'inspection_expiry' in v);
      },
      'no last_inspection_date field': (r) => {
        const vehicles = JSON.parse(r.body);
        return vehicles.length === 0 || !vehicles.some(v => 'last_inspection_date' in v);
      },
    });
    
    if (res.status === 200) {
      const vehicles = JSON.parse(res.body);
      if (vehicles.length > 0) {
        vehicleId = vehicles[0].id;
      }
    }
    
    thinkTime(0.5, 1);
  });
  
  group('Vehicle Details with Inspection Expiry', () => {
    if (!vehicleId) {
      console.log('Skipping: No vehicle ID available');
      return;
    }
    
    const res = http.get(`${baseUrl}/api/vehicles/${vehicleId}`, {
      tags: { endpoint: 'vehicles', operation: 'get' },
    });
    
    check(res, {
      'vehicle details returns 200': (r) => r.status === 200,
      'has inspection_expiry field': (r) => {
        const vehicle = JSON.parse(r.body);
        return 'inspection_expiry' in vehicle;
      },
      'inspection_expiry format valid': (r) => {
        const vehicle = JSON.parse(r.body);
        if (!vehicle.inspection_expiry) return true;
        return /^\d{4}-\d{2}-\d{2}/.test(vehicle.inspection_expiry);
      },
      'has required compliance fields': (r) => {
        const vehicle = JSON.parse(r.body);
        return 'insurance_expiry' in vehicle && 'registration_expiry' in vehicle;
      },
    });
    
    thinkTime(0.5, 1);
  });
  
  group('Vehicle Sorting by Inspection Expiry', () => {
    const res = http.get(`${baseUrl}/api/vehicles?sortBy=inspection_expiry&order=asc`, {
      tags: { endpoint: 'vehicles', operation: 'sort' },
    });
    
    check(res, {
      'sorted vehicles returns 200': (r) => r.status === 200,
      'sorting works correctly': (r) => {
        const vehicles = JSON.parse(r.body);
        if (vehicles.length < 2) return true;
        
        // Check if sorted ascending
        for (let i = 0; i < vehicles.length - 1; i++) {
          if (vehicles[i].inspection_expiry && vehicles[i + 1].inspection_expiry) {
            if (vehicles[i].inspection_expiry > vehicles[i + 1].inspection_expiry) {
              return false;
            }
          }
        }
        return true;
      },
    });
    
    thinkTime(0.3, 0.7);
  });
  
  group('Vehicle Filtering by Status', () => {
    const res = http.get(`${baseUrl}/api/vehicles?status=in-service`, {
      tags: { endpoint: 'vehicles', operation: 'filter' },
    });
    
    check(res, {
      'filtered vehicles returns 200': (r) => r.status === 200,
      'all vehicles match filter': (r) => {
        const vehicles = JSON.parse(r.body);
        return vehicles.every(v => v.status === 'in-service');
      },
    });
    
    thinkTime(0.3, 0.7);
  });
  
  group('Create Vehicle with Inspection Expiry', () => {
    const testVin = `TEST${Date.now()}${__VU}`;
    const testUnitNumber = `TST-${Date.now().toString().slice(-4)}`;
    
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const inspectionExpiry = futureDate.toISOString().split('T')[0];
    
    const newVehicle = {
      unit_number: testUnitNumber,
      vin: testVin,
      make: 'Test Make',
      model: 'Test Model',
      year: 2024,
      license_plate: `TST${Date.now().toString().slice(-4)}`,
      state: 'CA',
      status: 'in-service',
      mileage: 50000,
      inspection_expiry: inspectionExpiry,
      registration_expiry: inspectionExpiry,
      insurance_expiry: inspectionExpiry,
    };
    
    const res = http.post(
      `${baseUrl}/api/vehicles`,
      JSON.stringify(newVehicle),
      { headers, tags: { endpoint: 'vehicles', operation: 'create' } }
    );
    
    check(res, {
      'vehicle created successfully': (r) => r.status === 201,
      'response has id': (r) => {
        const vehicle = JSON.parse(r.body);
        return 'id' in vehicle && vehicle.id;
      },
      'inspection_expiry saved correctly': (r) => {
        const vehicle = JSON.parse(r.body);
        return vehicle.inspection_expiry === inspectionExpiry;
      },
      'no last_inspection_date in response': (r) => {
        const vehicle = JSON.parse(r.body);
        return !('last_inspection_date' in vehicle);
      },
    });
    
    if (res.status === 201) {
      vehicleId = JSON.parse(res.body).id;
    }
    
    thinkTime(0.5, 1);
  });
  
  group('Update Vehicle Inspection Expiry', () => {
    if (!vehicleId) {
      console.log('Skipping: No vehicle ID available');
      return;
    }
    
    const newExpiry = new Date();
    newExpiry.setFullYear(newExpiry.getFullYear() + 2);
    const expiryDate = newExpiry.toISOString().split('T')[0];
    
    const updateData = {
      inspection_expiry: expiryDate,
      mileage: 55000,
    };
    
    const res = http.put(
      `${baseUrl}/api/vehicles/${vehicleId}`,
      JSON.stringify(updateData),
      { headers, tags: { endpoint: 'vehicles', operation: 'update' } }
    );
    
    check(res, {
      'vehicle updated successfully': (r) => r.status === 200,
      'inspection_expiry updated': (r) => {
        const vehicle = JSON.parse(r.body);
        return vehicle.inspection_expiry === expiryDate;
      },
    });
    
    thinkTime(0.5, 1);
  });
  
  group('Vehicle Documents - List', () => {
    if (!vehicleId) {
      console.log('Skipping: No vehicle ID available');
      return;
    }
    
    const res = http.get(`${baseUrl}/api/vehicles/${vehicleId}/documents`, {
      tags: { endpoint: 'vehicle_documents', operation: 'list' },
    });
    
    check(res, {
      'documents list returns 200': (r) => r.status === 200 || r.status === 404,
      'response is array if 200': (r) => {
        if (r.status !== 200) return true;
        return Array.isArray(JSON.parse(r.body));
      },
    });
    
    thinkTime(0.3, 0.7);
  });
  
  group('Vehicle Documents - Create', () => {
    if (!vehicleId) {
      console.log('Skipping: No vehicle ID available');
      return;
    }
    
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    
    const newDocument = {
      vehicle_id: vehicleId,
      document_type: 'inspection',
      file_name: `inspection-${Date.now()}.pdf`,
      file_path: `/uploads/inspection-${Date.now()}.pdf`,
      file_size: 102400,
      mime_type: 'application/pdf',
      expiry_date: expiryDate.toISOString().split('T')[0],
      notes: 'Annual inspection document',
    };
    
    const res = http.post(
      `${baseUrl}/api/vehicles/${vehicleId}/documents`,
      JSON.stringify(newDocument),
      { headers, tags: { endpoint: 'vehicle_documents', operation: 'create' } }
    );
    
    check(res, {
      'document created successfully': (r) => r.status === 201,
      'response has id': (r) => {
        if (r.status !== 201) return false;
        const doc = JSON.parse(r.body);
        return 'id' in doc && doc.id;
      },
      'expiry_date saved correctly': (r) => {
        if (r.status !== 201) return false;
        const doc = JSON.parse(r.body);
        return 'expiry_date' in doc;
      },
    });
    
    if (res.status === 201) {
      documentId = JSON.parse(res.body).id;
    }
    
    thinkTime(0.5, 1);
  });
  
  group('Vehicle Documents - Delete', () => {
    if (!vehicleId || !documentId) {
      console.log('Skipping: No vehicle/document ID available');
      return;
    }
    
    const res = http.del(
      `${baseUrl}/api/vehicles/${vehicleId}/documents/${documentId}`,
      null,
      { tags: { endpoint: 'vehicle_documents', operation: 'delete' } }
    );
    
    check(res, {
      'document deleted successfully': (r) => r.status === 200 || r.status === 204,
    });
    
    thinkTime(0.3, 0.7);
  });
  
  group('Delete Test Vehicle', () => {
    if (!vehicleId) {
      console.log('Skipping: No vehicle ID available');
      return;
    }
    
    const res = http.del(`${baseUrl}/api/vehicles/${vehicleId}`, null, {
      tags: { endpoint: 'vehicles', operation: 'delete' },
    });
    
    check(res, {
      'vehicle deleted successfully': (r) => r.status === 200 || r.status === 204,
    });
  });
  
  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    test_type: 'vehicles_performance',
    timestamp: new Date().toISOString(),
    duration_ms: data.state.testRunDurationMs,
    total_requests: data.metrics.http_reqs?.values.count || 0,
    failed_requests: data.metrics.http_req_failed?.values.passes || 0,
    avg_duration_ms: data.metrics.http_req_duration?.values.avg || 0,
    p95_duration_ms: data.metrics['http_req_duration']?.values['p(95)'] || 0,
    p99_duration_ms: data.metrics['http_req_duration']?.values['p(99)'] || 0,
  };
  
  return {
    'reports/vehicles-performance.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  let summary = '\n✓ Vehicles Performance Test Summary\n';
  summary += '═'.repeat(60) + '\n';
  summary += `Test Duration: ${(data.state.testRunDurationMs / 1000).toFixed(2)}s\n`;
  summary += `Total Requests: ${data.metrics.http_reqs?.values.count || 0}\n`;
  summary += `Failed Requests: ${data.metrics.http_req_failed?.values.passes || 0}\n`;
  summary += `Avg Response Time: ${(data.metrics.http_req_duration?.values.avg || 0).toFixed(2)}ms\n`;
  summary += `P95 Response Time: ${(data.metrics['http_req_duration']?.values['p(95)'] || 0).toFixed(2)}ms\n`;
  summary += `P99 Response Time: ${(data.metrics['http_req_duration']?.values['p(99)'] || 0).toFixed(2)}ms\n`;
  summary += '═'.repeat(60) + '\n';
  
  return summary;
}
