const { query } = require('./config/database');

async function addColumn() {
  try {
    console.log('Adding vehicle_type column to vehicles table...');
    const result = await query(
      `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(20) DEFAULT 'truck'`
    );
    console.log('✅ Column added successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding column:', error.message);
    process.exit(1);
  }
}

addColumn();
