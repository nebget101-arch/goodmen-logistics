const { query } = require('../config/database');

async function updateSchema() {
  try {
    console.log('Updating drivers table schema to allow NULL dates...\n');
    
    // Remove NOT NULL constraints from date columns
    await query('ALTER TABLE drivers ALTER COLUMN cdl_expiry DROP NOT NULL');
    console.log('✅ cdl_expiry can now be NULL');
    
    await query('ALTER TABLE drivers ALTER COLUMN medical_cert_expiry DROP NOT NULL');
    console.log('✅ medical_cert_expiry can now be NULL');
    
    await query('ALTER TABLE drivers ALTER COLUMN hire_date DROP NOT NULL');
    console.log('✅ hire_date can now be NULL');
    
    console.log('\n✅ Schema updated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating schema:', error.message);
    process.exit(1);
  }
}

updateSchema();
