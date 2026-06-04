'use strict';

/**
 * FN-1694 (Story B / FN-1687) — Billing & trial lifecycle emails.
 *
 * SendGrid-backed transactional emails for the billing flow:
 *   - sendPaymentFailureEmail   — invoice.payment_failed webhook (ships the FN-76 TODO)
 *   - sendTrialEndingSoonEmail  — N-day trial reminders (sendTrialReminders.js)
 *   - sendTrialEndedEmail       — trial lapsed notice (sendTrialReminders.js)
 *
 * Mirrors the established `trial-request-email-service.js` conventions: inline
 * HTML (no handlebars/template files), `@sendgrid/mail`, a graceful no-op when
 * SendGrid isn't configured, and result objects instead of thrown errors so a
 * webhook/cron never crashes on a mail failure.
 *
 * (The legacy backend/emails/trialEmailService.js is intentionally NOT used: it
 * requires a `./emailService` module that does not exist anywhere in the repo,
 * so it cannot load. This service is the working replacement for the billing
 * paths that needed it.)
 */

const path = require('path');
const dotenv = require('dotenv');
const sgMail = require('@sendgrid/mail');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAppBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.APP_URL || 'https://fleetneuron.com').replace(/\/$/, '');
}

function getBillingUrl() {
  return `${getAppBaseUrl()}/billing`;
}

function getEmailConfig() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.ONBOARDING_FROM_EMAIL;
  return { apiKey, fromEmail };
}

function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function layout(title, bodyHtml) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'support@fleetneuron.com';
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:20px;color:#f8fafc;margin:0 0 16px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin:28px 0 0;font-size:12px;color:#94a3b8;">
        Need help? Contact <a href="mailto:${supportEmail}" style="color:#67e8f9;">${supportEmail}</a>.
      </p>
    </div>
  </body>
</html>`;
}

function ctaButton(href, label) {
  return `<p style="margin:24px 0;">
    <a href="${href}" style="background:#06b6d4;color:#0b1220;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block;">${escapeHtml(label)}</a>
  </p>`;
}

/** Internal: send + normalize result. Never throws. */
async function deliver({ to, subject, html, text }) {
  const { apiKey, fromEmail } = getEmailConfig();
  if (!apiKey || !fromEmail || !to) {
    return { sent: false, reason: 'email_not_configured' };
  }
  sgMail.setApiKey(apiKey);
  try {
    await sgMail.send({ to, from: fromEmail, subject, html, text });
    return { sent: true, to };
  } catch (err) {
    const error = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    return { sent: false, reason: 'send_failed', error };
  }
}

/**
 * Payment failed — card on file was declined; access continues until the grace
 * deadline. Sent once per failed invoice (the webhook fires once per failure).
 */
async function sendPaymentFailureEmail({ to, tenantName, gracePeriodEnd, gracePeriodDays } = {}) {
  const name = escapeHtml(tenantName || 'there');
  const deadline = formatDate(gracePeriodEnd);
  const days = Number.isFinite(Number(gracePeriodDays)) ? Number(gracePeriodDays) : null;
  const deadlineSentence = deadline
    ? `To avoid any interruption, please update your payment method by <strong>${deadline}</strong>${days ? ` (${days}-day grace period)` : ''}.`
    : 'To avoid any interruption, please update your payment method as soon as possible.';

  const body = `
    <p style="font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="font-size:15px;line-height:1.6;">We weren't able to process your most recent FleetNeuron payment. Your account is still active for now.</p>
    <p style="font-size:15px;line-height:1.6;">${deadlineSentence}</p>
    ${ctaButton(getBillingUrl(), 'Update payment method')}`;

  const text = [
    `Hi ${tenantName || 'there'},`,
    "We weren't able to process your most recent FleetNeuron payment. Your account is still active for now.",
    deadline
      ? `Please update your payment method by ${deadline}${days ? ` (${days}-day grace period)` : ''} to avoid interruption.`
      : 'Please update your payment method as soon as possible to avoid interruption.',
    `Update payment method: ${getBillingUrl()}`
  ].join('\n');

  return deliver({ to, subject: 'Payment failed — update your payment method', html: layout('Payment failed', body), text });
}

/** Trial ending soon — N-day reminder. */
async function sendTrialEndingSoonEmail({ to, tenantName, daysRemaining, trialEndDate } = {}) {
  const name = escapeHtml(tenantName || 'there');
  const end = formatDate(trialEndDate);
  const days = Number.isFinite(Number(daysRemaining)) ? Number(daysRemaining) : null;
  const whenSentence = days != null
    ? `Your FleetNeuron free trial ends in <strong>${days} day${days === 1 ? '' : 's'}</strong>${end ? ` on ${end}` : ''}.`
    : `Your FleetNeuron free trial is ending soon${end ? ` on ${end}` : ''}.`;

  const body = `
    <p style="font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="font-size:15px;line-height:1.6;">${whenSentence}</p>
    <p style="font-size:15px;line-height:1.6;">Add a payment method now to keep your data and avoid any interruption when the trial ends.</p>
    ${ctaButton(getBillingUrl(), 'Add payment method')}`;

  const text = [
    `Hi ${tenantName || 'there'},`,
    days != null
      ? `Your FleetNeuron free trial ends in ${days} day(s)${end ? ` on ${end}` : ''}.`
      : `Your FleetNeuron free trial is ending soon${end ? ` on ${end}` : ''}.`,
    'Add a payment method now to keep your data and avoid interruption.',
    `Add payment method: ${getBillingUrl()}`
  ].join('\n');

  const subject = days != null
    ? `Your FleetNeuron trial ends in ${days} day${days === 1 ? '' : 's'}`
    : 'Your FleetNeuron trial is ending soon';

  return deliver({ to, subject, html: layout('Your trial is ending soon', body), text });
}

/** Trial ended — trial lapsed without conversion. */
async function sendTrialEndedEmail({ to, tenantName } = {}) {
  const name = escapeHtml(tenantName || 'there');
  const body = `
    <p style="font-size:15px;line-height:1.6;">Hi ${name},</p>
    <p style="font-size:15px;line-height:1.6;">Your FleetNeuron free trial has ended. Add a payment method to reactivate your account and pick up right where you left off.</p>
    ${ctaButton(getBillingUrl(), 'Reactivate my account')}`;

  const text = [
    `Hi ${tenantName || 'there'},`,
    'Your FleetNeuron free trial has ended. Add a payment method to reactivate your account.',
    `Reactivate: ${getBillingUrl()}`
  ].join('\n');

  return deliver({ to, subject: 'Your FleetNeuron trial has ended', html: layout('Your trial has ended', body), text });
}

module.exports = {
  sendPaymentFailureEmail,
  sendTrialEndingSoonEmail,
  sendTrialEndedEmail
};
