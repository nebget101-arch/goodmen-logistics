const express = require('express');
const router = express.Router();
const { query } = require('../internal/db');

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

/**
 * @openapi
 * /api/communication-preferences:
 *   put:
 *     summary: Update communication opt-in preferences
 *     description: Public endpoint (no auth required) that upserts email/SMS opt-in preferences for a given email or phone number into the communication_consents table.
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [optInEmail, optInSms]
 *             properties:
 *               email: { type: string, format: email, description: At least one of email or phone is required }
 *               phone: { type: string, description: At least one of email or phone is required }
 *               optInEmail: { type: boolean }
 *               optInSms: { type: boolean }
 *     responses:
 *       200:
 *         description: Preferences updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *       400:
 *         description: Validation error — missing email/phone or boolean flags
 *       500:
 *         description: Server error
 */
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
