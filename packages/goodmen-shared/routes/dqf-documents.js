const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { query } = require('../internal/db');
const { uploadBuffer, getSignedDownloadUrl, deleteObject } = require('../storage/r2-storage');

// Configure multer for file uploads (memory storage for R2)
const upload = multer({
  storage: multer.memoryStorage(),
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
      return res.status(400).json({ message: 'Driver ID and document type are required' });
    }

    const fileExt = path.extname(req.file.originalname || '').toLowerCase();
    const safeName = req.file.originalname
      ? req.file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')
      : `dqf-${driverId}${fileExt}`;
    const { key: storageKey } = await uploadBuffer({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      prefix: `dqf-documents/${driverId}`,
      fileName: safeName
    });

    // Save file metadata to database
    const result = await query(
      `INSERT INTO dqf_documents (driver_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        driverId,
        documentType,
        req.file.originalname,
        storageKey,
        req.file.size,
        req.file.mimetype,
        uploadedBy || 'system'
      ]
    );

    res.status(201).json({
      message: 'File uploaded successfully',
      document: result.rows[0],
      downloadUrl: await getSignedDownloadUrl(storageKey)
    });
  } catch (error) {
    console.error('Error uploading file:', error);
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
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
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
    const data = await Promise.all(
      result.rows.map(async row => ({
        ...row,
        downloadUrl: row.file_path ? await getSignedDownloadUrl(row.file_path) : null
      }))
    );
    res.json(data);
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

    await deleteObject(document.file_path);

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

    const downloadUrl = await getSignedDownloadUrl(document.file_path);
    res.json({ downloadUrl });
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({ message: 'Failed to download document' });
  }
});

module.exports = router;
