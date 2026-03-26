'use strict';

/**
 * FN-270: Onboarding packet submission confirmation email.
 *
 * Uses the existing SendGrid configuration (SENDGRID_API_KEY, ONBOARDING_FROM_EMAIL)
 * to send a professional HTML confirmation to the driver after packet submission.
 *
 * Sending is non-blocking: callers should fire-and-forget so that a mail failure
 * never prevents the packet from being marked as submitted.
 */

const sgMail = require('@sendgrid/mail');
const dtLogger = require('../utils/logger');

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.ONBOARDING_FROM_EMAIL || 'FleetNeuron AI <noreply@fleetneuron.ai>';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the professional HTML confirmation email.
 *
 * @param {object} params
 * @param {string} params.driverFirstName
 * @param {string} params.driverLastName
 * @param {string} params.driverEmail
 * @param {object} params.operatingEntity - nullable
 * @param {object} params.completedSections - { employment_application, consent_forms, document_uploads }
 * @returns {string} HTML body
 */
function buildSubmissionConfirmationHtml({
  driverFirstName,
  driverLastName,
  operatingEntity,
  completedSections
}) {
  const name = escapeHtml(driverFirstName || 'Applicant');
  const companyName = escapeHtml(
    operatingEntity?.name || operatingEntity?.legal_name || 'the carrier'
  );

  const addressParts = [
    operatingEntity?.address_line1,
    operatingEntity?.address_line2,
    [operatingEntity?.city, operatingEntity?.state, operatingEntity?.zip_code]
      .filter(Boolean)
      .join(', ')
  ].filter(Boolean);
  const companyAddress = addressParts.length
    ? addressParts.map(escapeHtml).join('<br>')
    : '';
  const companyPhone = operatingEntity?.phone
    ? escapeHtml(operatingEntity.phone)
    : '';
  const companyEmail = operatingEntity?.email
    ? escapeHtml(operatingEntity.email)
    : '';

  // Section status bullets
  const sectionLabels = {
    employment_application: 'Employment Application',
    consent_forms: 'Consent & Authorization Forms',
    document_uploads: 'Document Uploads (CDL, Medical Card)'
  };
  const sectionBullets = Object.entries(sectionLabels)
    .map(([key, label]) => {
      const done = completedSections?.[key] === 'completed';
      const icon = done ? '&#10003;' : '&#8211;';
      const color = done ? '#0d9488' : '#94a3b8';
      return `<tr>
        <td style="padding:4px 10px 4px 0;color:${color};font-size:16px;vertical-align:top;">${icon}</td>
        <td style="padding:4px 0;color:#e2e8f0;font-size:14px;line-height:1.6;">${escapeHtml(label)}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Application Received</title>
</head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020617;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;border:1px solid rgba(13,148,136,.25);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%,#020617 100%);">

          <!-- Header -->
          <tr>
            <td style="padding:32px 28px 24px;background:radial-gradient(circle at top left,rgba(13,148,136,.18),transparent 45%),radial-gradient(circle at top right,rgba(14,165,233,.14),transparent 42%);border-bottom:1px solid rgba(148,163,184,.16);">
              <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#5eead4;margin-bottom:12px;">${companyName}</div>
              <h1 style="margin:0 0 8px;font-size:26px;line-height:1.25;color:#f8fafc;">Application Received</h1>
              <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">Your onboarding packet has been submitted successfully.</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 18px;color:#e2e8f0;font-size:15px;line-height:1.8;">
                Dear ${name},
              </p>
              <p style="margin:0 0 18px;color:#e2e8f0;font-size:15px;line-height:1.8;">
                Thank you for completing your driver onboarding application with ${companyName}. We have received all of your submitted information.
              </p>

              <!-- Submitted sections -->
              <div style="margin:0 0 22px;padding:16px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(15,23,42,.58);">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:10px;">What was submitted</div>
                <table role="presentation" cellspacing="0" cellpadding="0">
                  ${sectionBullets}
                </table>
              </div>

              <!-- Next steps -->
              <div style="margin:0 0 22px;padding:16px;border:1px solid rgba(13,148,136,.2);border-radius:12px;background:rgba(13,148,136,.06);">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5eead4;font-weight:700;margin-bottom:10px;">Next Steps</div>
                <p style="margin:0;color:#e2e8f0;font-size:14px;line-height:1.7;">
                  One of our team members will review your application and reach out to you shortly. No further action is required on your part at this time.
                </p>
              </div>

              ${companyPhone || companyEmail ? `
              <!-- Contact -->
              <div style="margin:0 0 8px;padding:16px;border:1px solid rgba(148,163,184,.12);border-radius:12px;background:rgba(15,23,42,.38);">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:10px;">Contact Us</div>
                ${companyPhone ? `<p style="margin:0 0 4px;color:#cbd5e1;font-size:14px;">Phone: ${companyPhone}</p>` : ''}
                ${companyEmail ? `<p style="margin:0;color:#cbd5e1;font-size:14px;">Email: <a href="mailto:${companyEmail}" style="color:#67e8f9;text-decoration:none;">${companyEmail}</a></p>` : ''}
              </div>
              ` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px;border-top:1px solid rgba(148,163,184,.12);">
              ${companyAddress ? `<p style="margin:0 0 6px;color:#64748b;font-size:12px;line-height:1.6;">${companyName}<br>${companyAddress}</p>` : ''}
              <p style="margin:0;color:#475569;font-size:11px;line-height:1.6;">Powered by FleetNeuron AI</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build plain-text fallback.
 */
function buildSubmissionConfirmationText({
  driverFirstName,
  operatingEntity,
  completedSections
}) {
  const name = driverFirstName || 'Applicant';
  const companyName = operatingEntity?.name || operatingEntity?.legal_name || 'the carrier';

  const sectionLabels = {
    employment_application: 'Employment Application',
    consent_forms: 'Consent & Authorization Forms',
    document_uploads: 'Document Uploads'
  };
  const bullets = Object.entries(sectionLabels)
    .map(([key, label]) => {
      const done = completedSections?.[key] === 'completed';
      return `  ${done ? '[x]' : '[ ]'} ${label}`;
    })
    .join('\n');

  return [
    `Dear ${name},`,
    '',
    `Thank you for completing your driver onboarding application with ${companyName}.`,
    'We have received all of your submitted information.',
    '',
    'What was submitted:',
    bullets,
    '',
    'Next Steps:',
    'One of our team members will review your application and reach out to you shortly.',
    'No further action is required on your part at this time.',
    '',
    `-- ${companyName}`,
    'Powered by FleetNeuron AI'
  ].join('\n');
}

/**
 * Send the packet submission confirmation email to the driver.
 * Non-blocking — callers should not await this or should catch errors.
 *
 * @param {object} params
 * @param {string} params.driverEmail - Required
 * @param {string} params.driverFirstName
 * @param {string} params.driverLastName
 * @param {object|null} params.operatingEntity
 * @param {object} params.completedSections - map of section_key -> status
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendPacketSubmissionConfirmation({
  driverEmail,
  driverFirstName,
  driverLastName,
  operatingEntity,
  completedSections
}) {
  if (!SENDGRID_KEY) {
    dtLogger.warn('onboarding_submission_email_skipped', { reason: 'SENDGRID_API_KEY not configured' });
    return { sent: false, reason: 'email_not_configured' };
  }

  const to = String(driverEmail || '').trim().toLowerCase();
  if (!to) {
    dtLogger.warn('onboarding_submission_email_skipped', { reason: 'no driver email' });
    return { sent: false, reason: 'no_email' };
  }

  const companyName = operatingEntity?.name || operatingEntity?.legal_name || 'FleetNeuron';
  const subject = `Application Received \u2014 ${companyName}`;

  const html = buildSubmissionConfirmationHtml({
    driverFirstName,
    driverLastName,
    operatingEntity,
    completedSections
  });

  const text = buildSubmissionConfirmationText({
    driverFirstName,
    operatingEntity,
    completedSections
  });

  try {
    await sgMail.send({
      to,
      from: FROM_EMAIL,
      subject,
      text,
      html
    });
    dtLogger.info('onboarding_submission_email_sent', { to, subject });
    return { sent: true, to };
  } catch (err) {
    const error = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    dtLogger.error('onboarding_submission_email_failed', { to, error });
    return { sent: false, reason: 'send_failed', error };
  }
}

module.exports = {
  buildSubmissionConfirmationHtml,
  buildSubmissionConfirmationText,
  sendPacketSubmissionConfirmation
};
