/**
 * Test script to demonstrate Dynatrace logging
 * Run this to see logs being sent to Dynatrace
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

console.log('🧪 Testing Dynatrace Logging...\n');

async function testAPIs() {
  try {
    console.log('1️⃣  Testing GET /api/health');
    const health = await axios.get(`${API_BASE}/health`);
    console.log(`   ✅ Response:`, health.data);
    console.log('');

    await sleep(500);

    console.log('2️⃣  Testing GET /api/drivers');
    const drivers = await axios.get(`${API_BASE}/drivers`);
    console.log(`   ✅ Found ${drivers.data.length} drivers`);
    console.log('');

    await sleep(500);

    console.log('3️⃣  Testing GET /api/vehicles');
    const vehicles = await axios.get(`${API_BASE}/vehicles`);
    console.log(`   ✅ Found ${vehicles.data.length} vehicles`);
    console.log('');

    await sleep(500);

    console.log('4️⃣  Testing GET /api/dashboard/stats');
    const stats = await axios.get(`${API_BASE}/dashboard/stats`);
    console.log(`   ✅ Dashboard stats:`, stats.data);
    console.log('');

    await sleep(500);

    console.log('5️⃣  Testing GET /api/loads');
    const loads = await axios.get(`${API_BASE}/loads`);
    console.log(`   ✅ Found ${loads.data.length} loads`);
    console.log('');

    await sleep(500);

    console.log('6️⃣  Testing GET /api/hos');
    const hos = await axios.get(`${API_BASE}/hos`);
    console.log(`   ✅ Found ${hos.data.length} HOS records`);
    console.log('');

    await sleep(500);

    console.log('7️⃣  Testing GET /api/maintenance');
    const maintenance = await axios.get(`${API_BASE}/maintenance`);
    console.log(`   ✅ Found ${maintenance.data.length} maintenance records`);
    console.log('');

    console.log('\n✅ All tests completed!');
    console.log('\n📊 Check your server logs to see Dynatrace logging in action:');
    console.log('   - API request tracking (method, path, status, duration)');
    console.log('   - Database query tracking (operation, table, duration)');
    console.log('   - Custom metrics (counts, durations)');
    console.log('   - Business events');
    console.log('\n💡 View these logs in Dynatrace:');
    console.log('   1. Go to: https://muz70888.apps.dynatrace.com');
    console.log('   2. Navigate to: Observe and explore → Metrics');
    console.log('   3. Search for: custom.*');
    console.log('   4. Filter by: app=Goodmen-Logistics-Backend');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run tests
testAPIs();
