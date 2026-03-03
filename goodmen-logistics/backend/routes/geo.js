const express = require('express');
const axios = require('axios');
const router = express.Router();
const { query } = require('../config/database');

async function zipTableExists() {
  try {
    const result = await query(`SELECT to_regclass('public.zip_codes') as reg`);
    return !!result.rows[0]?.reg;
  } catch {
    return false;
  }
}

router.get('/zip/:zip', async (req, res) => {
  const zip = (req.params.zip || '').toString().trim();
  if (!zip) {
    return res.status(400).json({ success: false, error: 'ZIP is required' });
  }

  try {
    const hasZipTable = await zipTableExists();
    if (hasZipTable) {
      const cached = await query('SELECT city, state FROM zip_codes WHERE zip = $1', [zip]);
      if (cached.rows.length > 0) {
        return res.json({ success: true, data: { zip, ...cached.rows[0] } });
      }
    }

    const response = await axios.get(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
    const place = response.data?.places?.[0];
    if (!place) {
      return res.status(404).json({ success: false, error: 'ZIP not found' });
    }

    const city = place['place name'];
    const state = place['state abbreviation'];

    if (hasZipTable) {
      await query(
        `INSERT INTO zip_codes (zip, city, state)
         VALUES ($1, $2, $3)
         ON CONFLICT (zip) DO NOTHING`,
        [zip, city, state]
      );
    }

    res.json({ success: true, data: { zip, city, state } });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ success: false, error: 'ZIP not found' });
    }
    console.error('Error fetching zip:', error);
    res.status(500).json({ success: false, error: 'Failed to lookup ZIP' });
  }
});

module.exports = router;
