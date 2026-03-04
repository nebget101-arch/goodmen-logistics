/**
 * Notification service: SMS via Twilio, email via SendGrid.
 * Used for sending driver onboarding packet links.
 *
 * Env vars (optional – if missing, methods no-op and return { sent: false, error: '...' }):
 *   Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   SendGrid: SENDGRID_API_KEY, ONBOARDING_FROM_EMAIL (e.g. "Goodmen Logistics <onboarding@yourdomain.com>")
 */

const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const { query } = require('../config/database');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;
const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.ONBOARDING_FROM_EMAIL || 'Goodmen Logistics <noreply@goodmenlogistics.com>';

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
}
if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
}

/**
 * Normalize phone to E.164 for Twilio (US: +1XXXXXXXXXX). Best-effort.
 * @param {string} phone
 * @returns {string|null} E.164 or null if unparseable
 */
function toE164(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}

/**
 * Send SMS via Twilio.
 * @param {string} toPhone - Recipient phone (will be normalized to E.164)
 * @param {string} body - Message text
 * @returns {Promise<{ sent: boolean, sid?: string, error?: string }>}
 */
async function sendSms(toPhone, body) {
  if (!twilioClient || !TWILIO_FROM) {
    return {
      sent: false,
      error: 'SMS not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)'
    };
  }
  const to = toE164(toPhone);
  if (!to) {
    return { sent: false, error: 'Invalid or missing phone number' };
  }
  try {
    const message = await twilioClient.messages.create({
      body,
      from: TWILIO_FROM,
      to
    });
    return { sent: true, sid: message.sid };
  } catch (err) {
    const message = err.message || String(err);
    return { sent: false, error: message };
  }
}

/**
 * Send email via SendGrid.
 * @param {object} options - { to: string, subject: string, text?: string, html?: string }
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendEmail(options) {
  if (!SENDGRID_KEY) {
    return {
      sent: false,
      error: 'Email not configured (set SENDGRID_API_KEY)'
    };
  }
  const { to, subject, text, html } = options || {};
  if (!to || !subject) {
    return { sent: false, error: 'Missing to or subject' };
  }
  try {
    await sgMail.send({
      to,
      from: FROM_EMAIL,
      subject,
      text: text || '',
      html: html || (text ? text.replace(/\n/g, '<br>') : '')
    });
    return { sent: true };
  } catch (err) {
    const message = err.response?.body?.errors?.[0]?.message || err.message || String(err);
    return { sent: false, error: message };
  }
}

/**
 * Check communication consent for a phone/email. Returns { optInSms: true, optInEmail: true } if no record (default allow).
 * @param {string|null} phoneE164
 * @param {string|null} emailNorm - lowercase email
 */
async function getConsent(phoneE164, emailNorm) {
  let optInSms = true;
  let optInEmail = true;
  try {
    if (phoneE164) {
      const r = await query(
        'SELECT opt_in_sms FROM communication_consents WHERE identifier_type = $1 AND identifier_value = $2',
        ['phone', phoneE164]
      );
      if (r.rows.length > 0) optInSms = r.rows[0].opt_in_sms;
    }
    if (emailNorm) {
      const r = await query(
        'SELECT opt_in_email FROM communication_consents WHERE identifier_type = $1 AND identifier_value = $2',
        ['email', emailNorm]
      );
      if (r.rows.length > 0) optInEmail = r.rows[0].opt_in_email;
    }
  } catch (_) {
    // Table may not exist or DB error; default to allow
  }
  return { optInSms, optInEmail };
}

/**
 * Send onboarding packet link via SMS and/or email. Respects communication_consents opt-out.
 * @param {object} params
 * @param {string} params.publicUrl - Full URL with token
 * @param {string} [params.phone] - For SMS
 * @param {string} [params.email] - For email
 * @param {'sms'|'email'|'both'} params.via
 * @param {string} [params.driverName] - Optional, for message body
 * @returns {Promise<{ sms: { sent: boolean, error?: string }, email: { sent: boolean, error?: string } }>}
 */
async function sendOnboardingLink({ publicUrl, phone, email, via, driverName }) {
  const driverLabel = driverName ? ` ${driverName}` : '';
  const smsBody = `Goodmen Logistics: Complete your driver onboarding${driverLabel}. ${publicUrl}`;
  const emailSubject = 'Complete your Goodmen Logistics driver onboarding';
  const emailText = `Hello${driverLabel},\n\nPlease complete your driver onboarding by opening this link (valid 7 days):\n\n${publicUrl}\n\n— Goodmen Logistics`;

  const result = { sms: { sent: false }, email: { sent: false } };

  const phoneE164 = phone ? toE164(phone) : null;
  const emailNorm = email && typeof email === 'string' ? email.trim().toLowerCase() : null;
  const consent = await getConsent(phoneE164, emailNorm);

  if (via === 'sms' || via === 'both') {
    if (phone) {
      if (!consent.optInSms) {
        result.sms = { sent: false, error: 'You have opted out of SMS communications.' };
      } else {
        const smsResult = await sendSms(phone, smsBody);
        result.sms = smsResult;
      }
    } else {
      result.sms = { sent: false, error: 'No phone number provided' };
    }
  }

  if (via === 'email' || via === 'both') {
    if (email) {
      if (!consent.optInEmail) {
        result.email = { sent: false, error: 'You have opted out of email communications.' };
      } else {
        const emailResult = await sendEmail({
          to: email,
          subject: emailSubject,
          text: emailText,
          html: `<p>Hello${driverLabel},</p><p>Please complete your driver onboarding by opening this link (valid 7 days):</p><p><a href="${publicUrl}">${publicUrl}</a></p><p>— Goodmen Logistics</p>`
        });
        result.email = emailResult;
      }
    } else {
      result.email = { sent: false, error: 'No email address provided' };
    }
  }

  return result;
}

module.exports = {
  sendSms,
  sendEmail,
  sendOnboardingLink,
  getConsent,
  toE164
};
