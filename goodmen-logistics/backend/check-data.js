const { query } = require('./config/database');

async function checkData() {
  try {
    console.log('Checking database data...\n');
    
    // Check drivers
    const driversResult = await query('SELECT COUNT(*) as count FROM drivers');
    console.log(`Drivers: ${driversResult.rows[0].count} records`);
    
    // Check vehicles
    const vehiclesResult = await query('SELECT COUNT(*) as count FROM vehicles');
    console.log(`Vehicles: ${vehiclesResult.rows[0].count} records`);
    
    // Check hos_records
    const hosResult = await query('SELECT COUNT(*) as count FROM hos_records');
    console.log(`HOS Records: ${hosResult.rows[0].count} records`);
    
    // Check loads
    const loadsResult = await query('SELECT COUNT(*) as count FROM loads');
    console.log(`Loads: ${loadsResult.rows[0].count} records`);
    
    // Check maintenance
    const maintenanceResult = await query('SELECT COUNT(*) as count FROM maintenance_records');
    console.log(`Maintenance Records: ${maintenanceResult.rows[0].count} records`);
    
    // Check drug/alcohol tests
    const drugTestsResult = await query('SELECT COUNT(*) as count FROM drug_alcohol_tests');
    console.log(`Drug/Alcohol Tests: ${drugTestsResult.rows[0].count} records`);
    
    // Show sample driver data
    const sampleDrivers = await query('SELECT first_name, last_name, email, dqf_completeness FROM drivers LIMIT 3');
    console.log('\nSample Drivers:');
    sampleDrivers.rows.forEach(driver => {
      console.log(`  - ${driver.first_name} ${driver.last_name} (${driver.email}) - DQF: ${driver.dqf_completeness}%`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking data:', error.message);
    process.exit(1);
  }
}

checkData();
