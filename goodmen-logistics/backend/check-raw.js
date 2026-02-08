const { query } = require('./config/database');

async function checkRawData() {
  try {
    console.log('Checking RAW database response...\n');
    
    const result = await query('SELECT * FROM drivers ORDER BY created_at DESC LIMIT 1');
    
    console.log('Column names from database:');
    console.log(Object.keys(result.rows[0]));
    
    console.log('\nFull first driver record:');
    console.log(JSON.stringify(result.rows[0], null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkRawData();
