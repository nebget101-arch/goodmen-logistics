require('dotenv').config();
const { query, pool } = require('../config/database');

async function addVehicleDocumentsTable() {
  try {
    console.log('📡 Adding vehicle_documents table...');

    // Check if table already exists
    const checkTable = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'vehicle_documents'
      );
    `);

    if (checkTable.rows[0].exists) {
      console.log('✅ vehicle_documents table already exists');
      await pool.end();
      return;
    }

    // Create vehicle_documents table
    await query(`
      CREATE TABLE vehicle_documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        document_type VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        expiry_date DATE,
        uploaded_by VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Created vehicle_documents table');

    // Create indexes
    await query('CREATE INDEX idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);');
    await query('CREATE INDEX idx_vehicle_documents_type ON vehicle_documents(document_type);');
    await query('CREATE INDEX idx_vehicle_documents_expiry ON vehicle_documents(expiry_date);');

    console.log('✅ Created indexes');

    // Create trigger for updated_at
    await query(`
      CREATE TRIGGER update_vehicle_documents_updated_at 
      BEFORE UPDATE ON vehicle_documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log('✅ Created trigger');
    console.log('✅ Migration completed successfully');

    await pool.end();
  } catch (error) {
    console.error('❌ Error running migration:', error.message);
    process.exit(1);
  }
}

addVehicleDocumentsTable();
