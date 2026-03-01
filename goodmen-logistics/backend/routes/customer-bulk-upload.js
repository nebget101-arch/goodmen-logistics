const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const authMiddleware = require('../middleware/auth-middleware');
const dtLogger = require('../utils/dynatrace-logger');
const customersService = require('../services/customers.service');
const db = require('../config/knex');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role || 'technician';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// GET /api/customers/bulk-upload/template - Download template
router.get('/bulk-upload/template', authMiddleware, (req, res) => {
  try {
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Sample data for template
    const templateData = [
      {
        'Company Name': 'ABC Trucking',
        'Contact Name': 'John Smith',
        'Email': 'john@abctrucking.com',
        'Phone': '555-0123',
        'Type': 'individual',
        'DOT Number': '123456',
        'Address': '123 Main St',
        'City': 'Springfield',
        'State': 'IL',
        'Zip Code': '62701',
        'Payment Terms': 'net30',
        'Status': 'active'
      },
      {
        'Company Name': 'XYZ Logistics',
        'Contact Name': 'Jane Doe',
        'Email': 'jane@xyzlogistics.com',
        'Phone': '555-9876',
        'Type': 'company',
        'DOT Number': '789012',
        'Address': '456 Oak Ave',
        'City': 'Chicago',
        'State': 'IL',
        'Zip Code': '60601',
        'Payment Terms': 'net15',
        'Status': 'active'
      }
    ];

    // Add data to sheet
    const ws = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 20 },
      { wch: 20 },
      { wch: 25 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 25 },
      { wch: 15 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    
    // Add instructions sheet
    const instructionsData = [
      { Field: 'Company Name', Required: 'Yes', Description: 'Customer company name' },
      { Field: 'Contact Name', Required: 'Yes', Description: 'Primary contact person name' },
      { Field: 'Email', Required: 'Yes', Description: 'Valid email address' },
      { Field: 'Phone', Required: 'Yes', Description: 'Phone number (format: XXX-XXX-XXXX)' },
      { Field: 'Type', Required: 'No', Description: 'individual or company (default: individual)' },
      { Field: 'DOT Number', Required: 'No', Description: 'Department of Transportation number' },
      { Field: 'Address', Required: 'No', Description: 'Street address' },
      { Field: 'City', Required: 'No', Description: 'City name' },
      { Field: 'State', Required: 'No', Description: 'State abbreviation (e.g., IL)' },
      { Field: 'Zip Code', Required: 'No', Description: 'Postal code' },
      { Field: 'Payment Terms', Required: 'No', Description: 'net15, net30, net60, or COD (default: net30)' },
      { Field: 'Status', Required: 'No', Description: 'active or inactive (default: active)' }
    ];

    const wsInstructions = XLSX.utils.json_to_sheet(instructionsData);
    wsInstructions['!cols'] = [
      { wch: 20 },
      { wch: 12 },
      { wch: 40 }
    ];

    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    // Send file
    const fileName = 'customer-upload-template.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    res.send(buffer);
  } catch (error) {
    dtLogger.error('template_download_failed', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// POST /api/customers/bulk-upload - Upload and process file
router.post('/bulk-upload', authMiddleware, requireRole(['admin', 'service_advisor', 'accounting']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Parse Excel file
    let workbook, rows;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(worksheet);
    } catch (parseError) {
      return res.status(400).json({ error: 'Failed to parse Excel file: ' + parseError.message });
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data found in Excel file' });
    }

    const results = {
      successful: [],
      failed: [],
      total: rows.length
    };

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Validate required fields
        const companyName = row['Company Name'] ? row['Company Name'].toString().trim() : '';
        const contactName = row['Contact Name'] ? row['Contact Name'].toString().trim() : '';
        const email = row['Email'] ? row['Email'].toString().trim() : '';
        const phone = row['Phone'] ? row['Phone'].toString().trim() : '';

        const errors = [];
        if (!companyName) errors.push('Company Name is required');
        if (!contactName) errors.push('Contact Name is required');
        if (!email) errors.push('Email is required');
        if (email && !isValidEmail(email)) errors.push('Invalid email format');
        if (!phone) errors.push('Phone is required');

        if (errors.length > 0) {
          results.failed.push({
            row: i + 2,
            company: companyName || 'Unknown',
            errors
          });
          continue;
        }

        // Prepare customer object
        const customerData = {
          company_name: companyName,
          name: contactName,
          email,
          phone,
          type: (row['Type'] ? row['Type'].toString().toLowerCase() : 'individual') || 'individual',
          dot_number: (row['DOT Number'] ? row['DOT Number'].toString().trim() : null) || null,
          address: (row['Address'] ? row['Address'].toString().trim() : null) || null,
          city: (row['City'] ? row['City'].toString().trim() : null) || null,
          state: (row['State'] ? row['State'].toString().trim() : null) || null,
          zip_code: (row['Zip Code'] ? row['Zip Code'].toString().trim() : null) || null,
          payment_terms: (row['Payment Terms'] ? row['Payment Terms'].toString().toLowerCase() : 'net30') || 'net30',
          status: (row['Status'] ? row['Status'].toString().toLowerCase() : 'active') || 'active'
        };

        // Check if customer already exists
        let existingCustomer;
        try {
          existingCustomer = await db('customers')
            .where({ email, company_name: companyName })
            .first();
        } catch (dbError) {
          results.failed.push({
            row: i + 2,
            company: companyName,
            errors: ['Database error: ' + dbError.message]
          });
          continue;
        }

        if (existingCustomer) {
          results.failed.push({
            row: i + 2,
            company: companyName,
            errors: ['Customer with this email and company name already exists']
          });
          continue;
        }

        // Create customer
        let customer, validationErrors;
        try {
          const createResult = await customersService.createCustomer(customerData, req.user?.id);
          customer = createResult.customer;
          validationErrors = createResult.errors;
        } catch (serviceError) {
          results.failed.push({
            row: i + 2,
            company: companyName,
            errors: [serviceError.message || 'Failed to create customer']
          });
          continue;
        }

        if (validationErrors) {
          results.failed.push({
            row: i + 2,
            company: companyName,
            errors: Array.isArray(validationErrors) ? validationErrors : [validationErrors]
          });
        } else if (customer) {
          results.successful.push({
            row: i + 2,
            company: companyName,
            id: customer.id
          });
        }
      } catch (error) {
        results.failed.push({
          row: i + 2,
          company: row['Company Name'] ? row['Company Name'].toString() : 'Unknown',
          errors: [error.message || 'Unknown error occurred']
        });
      }
    }

    dtLogger.info('bulk_upload_completed', {
      successful: results.successful.length,
      failed: results.failed.length
    });

    res.json({
      success: true,
      message: `Uploaded ${results.successful.length} customers, ${results.failed.length} failed`,
      results
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    dtLogger.error('bulk_upload_failed', error);
    res.status(500).json({ error: error.message || 'Failed to process upload' });
  }
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

module.exports = router;
