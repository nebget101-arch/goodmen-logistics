const express = require('express');
const router = express.Router();
// const { query } = require('../config/database');
// const dtLogger = require('../utils/dynatrace-logger');
const auth = require('./auth-middleware');

// Protect all loads routes: admin, dispatch
router.use(auth(['admin', 'dispatch']));

const notImplemented = (req, res) => {
  res.status(501).json({ message: 'Loads API is not available in this deployment.' });
};

router.get('/', notImplemented);
router.get('/:id', notImplemented);
router.get('/status/:status', notImplemented);
router.get('/driver/:driverId', notImplemented);
router.post('/', notImplemented);
router.put('/:id', notImplemented);
router.delete('/:id', notImplemented);

module.exports = router;
