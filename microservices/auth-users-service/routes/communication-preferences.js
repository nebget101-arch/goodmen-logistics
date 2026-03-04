const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return null;
}

// PUT /api/communication-preferences (public – no auth)
router.put('/', async (req, res) => {
  try {
    const { email, phone, optInEmail, optInSms } = req.body || {};

    const updates = [];
    const emailNorm = normalizeEmail(email);
    const phoneNorm = normalizePhone(phone);

    if (!emailNorm && !phoneNorm) {
      return res.status(400).json({ message: 'Please provide an email or phone number.' });
    }

    if (typeof optInEmail !== 'boolean' || typeof optInSms !== 'boolean') {
      return res.status(400).json({ message: 'optInEmail and optInSms must be true or false.' });
    }

    if (emailNorm) {
      await query(
        `INSERT INTO communication_consents (identifier_type, identifier_value, opt_in_email, opt_in_sms, updated_at)
         VALUES ('email', $1, $2, $3, NOW())
         ON CONFLICT (identifier_type, identifier_value)
         DO UPDATE SET opt_in_email = $2, opt_in_sms = $3, updated_at = NOW()`,
        [emailNorm, optInEmail, optInSms]
      );
    }

    if (phoneNorm) {
      await query(
        `INSERT INTO communication_consents (identifier_type, identifier_value, opt_in_email, opt_in_sms, updated_at)
         VALUES ('phone', $1, $2, $3, NOW())
         ON CONFLICT (identifier_type, identifier_value)
         DO UPDATE SET opt_in_email = $2, opt_in_sms = $3, updated_at = NOW()`,
        [phoneNorm, optInEmail, optInSms]
      );
    }

    return res.json({ success: true, message: 'Preferences updated.' });
  } catch (err) {
    console.error('Communication preferences error:', err);
    return res.status(500).json({ message: 'Failed to update preferences.' });
  }
});

module.exports = router;
