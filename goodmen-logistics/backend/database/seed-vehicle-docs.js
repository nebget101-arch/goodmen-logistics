require('dotenv').config();
const { query, pool } = require('../config/database');

async function seedVehicleDocuments() {
  try {
    console.log('📡 Seeding vehicle documents...');

    // Check if documents already exist
    const checkDocs = await query('SELECT COUNT(*) FROM vehicle_documents');
    if (parseInt(checkDocs.rows[0].count) > 0) {
      console.log('✅ Vehicle documents already seeded');
      await pool.end();
      return;
    }

    // Get vehicle IDs
    const vehicles = await query('SELECT id, unit_number FROM vehicles');
    const vehicleMap = {};
    vehicles.rows.forEach(v => {
      vehicleMap[v.unit_number] = v.id;
    });

    // Add documents
    const documents = [
      {
        vehicle_id: vehicleMap['TRK-001'],
        document_type: 'inspection',
        file_name: 'annual_inspection_2025.pdf',
        file_path: '/uploads/vehicles/TRK-001/inspection_2025.pdf',
        file_size: 245632,
        mime_type: 'application/pdf',
        expiry_date: '2026-01-15',
        uploaded_by: 'admin',
        notes: 'Annual DOT inspection completed'
      },
      {
        vehicle_id: vehicleMap['TRK-001'],
        document_type: 'registration',
        file_name: 'vehicle_registration.pdf',
        file_path: '/uploads/vehicles/TRK-001/registration.pdf',
        file_size: 128456,
        mime_type: 'application/pdf',
        expiry_date: '2025-11-30',
        uploaded_by: 'admin',
        notes: 'California vehicle registration'
      },
      {
        vehicle_id: vehicleMap['TRK-002'],
        document_type: 'insurance',
        file_name: 'insurance_certificate.pdf',
        file_path: '/uploads/vehicles/TRK-002/insurance.pdf',
        file_size: 198234,
        mime_type: 'application/pdf',
        expiry_date: '2025-12-31',
        uploaded_by: 'admin',
        notes: 'Commercial vehicle insurance policy'
      },
      {
        vehicle_id: vehicleMap['TRK-003'],
        document_type: 'maintenance',
        file_name: 'brake_repair_receipt.pdf',
        file_path: '/uploads/vehicles/TRK-003/maintenance_brake_2025.pdf',
        file_size: 87456,
        mime_type: 'application/pdf',
        expiry_date: null,
        uploaded_by: 'admin',
        notes: 'Brake system repair - OOS reason'
      }
    ];

    for (const doc of documents) {
      await query(
        `INSERT INTO vehicle_documents (vehicle_id, document_type, file_name, file_path, file_size, mime_type, expiry_date, uploaded_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [doc.vehicle_id, doc.document_type, doc.file_name, doc.file_path, doc.file_size, doc.mime_type, doc.expiry_date, doc.uploaded_by, doc.notes]
      );
    }

    console.log('✅ Vehicle documents seeded successfully');
    
    const countResult = await query('SELECT COUNT(*) FROM vehicle_documents');
    console.log(`✅ Total documents: ${countResult.rows[0].count}`);

    await pool.end();
  } catch (error) {
    console.error('❌ Error seeding vehicle documents:', error.message);
    process.exit(1);
  }
}

seedVehicleDocuments();
