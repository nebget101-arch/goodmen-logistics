const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET all drug/alcohol records (restricted access in production)
router.get('/', async (req, res) => {
  try {
    // In production, this should have strict RBAC
    const result = await query(`
      SELECT dat.*, d.first_name || ' ' || d.last_name as "driverName"
      FROM drug_alcohol_tests dat
      JOIN drivers d ON dat.driver_id = d.id
      ORDER BY dat.test_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drug/alcohol tests:', error);
    res.status(500).json({ message: 'Failed to fetch drug/alcohol tests' });
  }
});

// GET records by driver ID
router.get('/driver/:driverId', (req, res) => {
  const records = drugAlcoholRecords.filter(r => r.driverId === req.params.driverId);
  res.json(records);
});

// POST create new test record
router.post('/', (req, res) => {
  const newRecord = {
    id: require('uuid').v4(),
    ...req.body
  };
  drugAlcoholRecords.push(newRecord);
  res.status(201).json(newRecord);
});

// GET summary (anonymized for dispatchers)
router.get('/summary', (req, res) => {
  const summary = drugAlcoholRecords.map(r => ({
    driverId: r.driverId,
    driverName: r.driverName,
    lastTestDate: r.testDate,
    status: r.result === 'Negative' ? 'Eligible' : 'Review Required'
  }));
  res.json(summary);
});

module.exports = router;
