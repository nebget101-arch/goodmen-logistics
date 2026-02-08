const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads/dqf-documents');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, images, and Word documents are allowed!'));
    }
  }
});

// POST upload DQF document
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { driverId, documentType, uploadedBy } = req.body;

    if (!driverId || !documentType) {
      // Delete uploaded file if validation fails
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Driver ID and document type are required' });
    }

    // Save file metadata to database
    const result = await query(
      `INSERT INTO dqf_documents (driver_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        driverId,
        documentType,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        uploadedBy || 'system'
      ]
    );

    res.status(201).json({
      message: 'File uploaded successfully',
      document: result.rows[0]
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: 'Failed to upload file' });
  }
});

// GET all documents for a driver
router.get('/driver/:driverId', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM dqf_documents WHERE driver_id = $1 ORDER BY created_at DESC`,
      [req.params.driverId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// GET documents by type for a driver
router.get('/driver/:driverId/type/:documentType', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM dqf_documents 
       WHERE driver_id = $1 AND document_type = $2 
       ORDER BY created_at DESC`,
      [req.params.driverId, req.params.documentType]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// DELETE a document
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM dqf_documents WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    // Delete file from filesystem
    if (fs.existsSync(document.file_path)) {
      fs.unlinkSync(document.file_path);
    }

    // Delete from database
    await query('DELETE FROM dqf_documents WHERE id = $1', [req.params.id]);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

// GET download a document
router.get('/download/:id', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM dqf_documents WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = result.rows[0];

    if (!fs.existsSync(document.file_path)) {
      return res.status(404).json({ message: 'File not found on server' });
    }

    res.download(document.file_path, document.file_name);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({ message: 'Failed to download document' });
  }
});

module.exports = router;
