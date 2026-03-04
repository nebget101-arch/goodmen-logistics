const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const auth = require('./auth-middleware');

// Protect all drug/alcohol routes: admin, safety
router.use(auth(['admin', 'safety']));

// GET all drug and alcohol tests
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT da.*, d.first_name, d.last_name
       FROM drug_alcohol_tests da
       JOIN drivers d ON da.driver_id = d.id
       ORDER BY da.test_date DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drug/alcohol tests:', error);
    res.status(500).json({ message: 'Failed to fetch drug/alcohol tests' });
  }
});

// GET drug/alcohol test by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT da.*, d.first_name, d.last_name
       FROM drug_alcohol_tests da
       JOIN drivers d ON da.driver_id = d.id
       WHERE da.id = $1`,
      [req.params.id]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: 'Test record not found' });
    }
  } catch (error) {
    console.error('Error fetching test record:', error);
    res.status(500).json({ message: 'Failed to fetch test record' });
  }
});

// POST create new drug/alcohol test
router.post('/', async (req, res) => {
  try {
    const { driverId, testType, testDate, result, notes } = req.body;

    const insertResult = await query(
      `INSERT INTO drug_alcohol_tests 
       (driver_id, test_type, test_date, result, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [driverId, testType, testDate, result, notes]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    console.error('Error creating test record:', error);
    res.status(500).json({ message: 'Failed to create test record' });
  }
});

// PUT update drug/alcohol test
router.put('/:id', async (req, res) => {
  try {
    const { testType, testDate, result, notes } = req.body;

    const updateResult = await query(
      `UPDATE drug_alcohol_tests 
       SET test_type = $1, test_date = $2, result = $3, notes = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [testType, testDate, result, notes, req.params.id]
    );

    if (updateResult.rows.length > 0) {
      res.json(updateResult.rows[0]);
    } else {
      res.status(404).json({ message: 'Test record not found' });
    }
  } catch (error) {
    console.error('Error updating test record:', error);
    res.status(500).json({ message: 'Failed to update test record' });
  }
});

// DELETE drug/alcohol test
router.delete('/:id', async (req, res) => {
  try {
    const deleteResult = await query(
      'DELETE FROM drug_alcohol_tests WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (deleteResult.rows.length > 0) {
      res.json({ message: 'Test record deleted successfully' });
    } else {
      res.status(404).json({ message: 'Test record not found' });
    }
  } catch (error) {
    console.error('Error deleting test record:', error);
    res.status(500).json({ message: 'Failed to delete test record' });
  }
});

module.exports = router;
