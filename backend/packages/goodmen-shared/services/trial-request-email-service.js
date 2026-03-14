'use strict';

const path = require('path');
const dotenv = require('dotenv');
const sgMail = require('@sendgrid/mail');
const { PLANS } = require('../config/plans');

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const PLAN_LABELS = {
  basic: 'Basic',
  multi_mc: 'Multi-MC',
  end_to_end: 'End-to-End'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseRecipientList(raw) {
  return String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function formatBool(value) {
  return value ? 'Yes' : 'No';
}

function getAppHomeUrl() {
  return (process.env.APP_BASE_URL || 'https://fleetneuron.com').replace(/\/$/, '');
}

function getEmailConfig() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.ONBOARDING_FROM_EMAIL;
  return { apiKey, fromEmail };
}

function getPlan(record) {
  const planId = record?.requested_plan;
  return PLANS[planId] || null;
}

function buildTrialRequestNotificationHtml(record, options = {}) {
  const reviewUrl = options.reviewUrl || '#';
  const replyEmail = record?.email || '';

  const safe = {
    id: escapeHtml(record?.id || ''),
    companyName: escapeHtml(record?.company_name || ''),
    contactName: escapeHtml(record?.contact_name || ''),
    email: escapeHtml(record?.email || ''),
    phone: escapeHtml(record?.phone || ''),
    fleetSize: escapeHtml(record?.fleet_size || 'Not provided'),
    currentSystem: escapeHtml(record?.current_system || 'Not provided'),
    requestedPlan: escapeHtml(PLAN_LABELS[record?.requested_plan] || record?.requested_plan || ''),
    wantsDemoAssistance: escapeHtml(formatBool(Boolean(record?.wants_demo_assistance))),
    notes: escapeHtml(record?.notes || 'No notes provided'),
    source: escapeHtml(record?.source || 'marketing_website'),
    createdAt: escapeHtml(record?.created_at || new Date().toISOString())
  };

  return `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Trial Request</title>
  </head>
  <body style="margin:0;padding:0;background:#020617;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020617;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;border:1px solid rgba(45,212,191,.22);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%, #020617 100%);">
            <tr>
              <td style="padding:28px;background:radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 45%),radial-gradient(circle at top right, rgba(14,165,233,.18), transparent 42%);border-bottom:1px solid rgba(148,163,184,.16);">
                <div style="display:inline-block;padding:6px 12px;border:1px solid rgba(45,212,191,.35);border-radius:999px;background:rgba(45,212,191,.1);font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#99f6e4;">FleetNeuron AI Alert</div>
                <h1 style="margin:14px 0 8px;font-size:28px;line-height:1.2;color:#f8fafc;">New Free Trial Request</h1>
                <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">A prospect submitted a trial request from the marketing website. Review details below and follow up quickly.</p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Company</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.companyName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Contact</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.contactName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Email</td>
                    <td style="padding:8px 0;text-align:right;"><a href="mailto:${safe.email}" style="color:#67e8f9;text-decoration:none;font-size:14px;font-weight:600;">${safe.email}</a></td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Phone</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.phone}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Requested Plan</td>
                    <td style="padding:8px 0;color:#a5f3fc;font-size:14px;font-weight:700;text-align:right;">${safe.requestedPlan}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Fleet Size</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.fleetSize}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Current System</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.currentSystem}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Needs Demo Help</td>
                    <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${safe.wantsDemoAssistance}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Source</td>
                    <td style="padding:8px 0;color:#cbd5e1;font-size:13px;text-align:right;">${safe.source}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Request ID</td>
                    <td style="padding:8px 0;color:#cbd5e1;font-size:13px;text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace;">${safe.id}</td>
                  </tr>
                </table>

                <div style="margin:18px 0 0;padding:14px 16px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(15,23,42,.58);">
                  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:8px;">Notes</div>
                  <div style="font-size:14px;line-height:1.7;color:#e2e8f0;">${safe.notes}</div>
                </div>

                <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:22px;">
                  <tr>
                    <td>
                      <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(90deg,#22c55e,#0ea5e9);color:#ecfeff;font-weight:700;font-size:14px;text-decoration:none;">Review Trial Requests</a>
                    </td>
                    <td style="width:10px;"></td>
                    <td>
                      <a href="mailto:${escapeHtml(replyEmail)}" style="display:inline-block;padding:12px 20px;border-radius:999px;border:1px solid rgba(148,163,184,.34);background:rgba(2,6,23,.5);color:#e2e8f0;font-weight:700;font-size:14px;text-decoration:none;">Reply to Contact</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 28px;border-top:1px solid rgba(148,163,184,.14);color:#64748b;font-size:12px;">
                Sent by FleetNeuron AI at ${safe.createdAt}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendNewTrialRequestNotification(record) {
  const { apiKey, fromEmail } = getEmailConfig();
  const toList = parseRecipientList(process.env.TRIAL_REQUEST_NOTIFY_TO || process.env.SALES_NOTIFY_EMAILS);

  if (!apiKey || !fromEmail || toList.length === 0) {
    return { sent: false, reason: 'email_not_configured' };
  }

  const reviewUrl = process.env.TRIAL_REQUEST_REVIEW_URL
    || `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/home/trial`;

  sgMail.setApiKey(apiKey);

  const subject = `🚀 New Trial Request: ${record?.company_name || 'Unknown Company'} · ${PLAN_LABELS[record?.requested_plan] || record?.requested_plan || 'Plan'}`;
  const html = buildTrialRequestNotificationHtml(record, { reviewUrl });
  const text = [
    'New trial request received',
    `Company: ${record?.company_name || ''}`,
    `Contact: ${record?.contact_name || ''}`,
    `Email: ${record?.email || ''}`,
    `Phone: ${record?.phone || ''}`,
    `Plan: ${PLAN_LABELS[record?.requested_plan] || record?.requested_plan || ''}`,
    `Fleet Size: ${record?.fleet_size || 'Not provided'}`,
    `Current System: ${record?.current_system || 'Not provided'}`,
    `Needs Demo Help: ${record?.wants_demo_assistance ? 'Yes' : 'No'}`,
    `Notes: ${record?.notes || 'No notes provided'}`,
    `Request ID: ${record?.id || ''}`,
    `Review URL: ${reviewUrl}`
  ].join('\n');

  try {
    await sgMail.send({
      to: toList,
      from: fromEmail,
      replyTo: record?.email || undefined,
      subject,
      text,
      html
    });
    return { sent: true, to: toList };
  } catch (err) {
    const error = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    return { sent: false, reason: 'send_failed', error };
  }
}

function buildRequesterUnderReviewHtml(record, options = {}) {
  const appHomeUrl = options.appHomeUrl || getAppHomeUrl();
  const name = escapeHtml(record?.contact_name || 'there');
  const company = escapeHtml(record?.company_name || 'your company');
  const requestedPlan = escapeHtml(PLAN_LABELS[record?.requested_plan] || record?.requested_plan || 'selected plan');

  return `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trial Request Received</title>
  </head>
  <body style="margin:0;padding:0;background:#020617;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020617;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;border:1px solid rgba(45,212,191,.22);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%, #020617 100%);">
            <tr>
              <td style="padding:28px;background:radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 45%),radial-gradient(circle at top right, rgba(14,165,233,.18), transparent 42%);border-bottom:1px solid rgba(148,163,184,.16);">
                <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;color:#f8fafc;">Your trial request is under review</h1>
                <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">Hi ${name}, thanks for your interest in FleetNeuron AI.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 14px;color:#e2e8f0;font-size:15px;line-height:1.8;">
                  We received your request for <strong>${company}</strong> on the <strong>${requestedPlan}</strong> plan.
                  Your request is currently <strong>under review</strong>.
                </p>
                <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.8;">
                  One of our sales representatives will reach out to you soon.
                </p>
                <a href="${escapeHtml(appHomeUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(90deg,#22c55e,#0ea5e9);color:#ecfeff;font-weight:700;font-size:14px;text-decoration:none;">Visit FleetNeuron</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendRequesterUnderReviewEmail(record) {
  const { apiKey, fromEmail } = getEmailConfig();
  const to = String(record?.email || '').trim().toLowerCase();

  if (!apiKey || !fromEmail || !to) {
    return { sent: false, reason: 'email_not_configured' };
  }

  sgMail.setApiKey(apiKey);

  const subject = 'We received your FleetNeuron trial request';
  const html = buildRequesterUnderReviewHtml(record, { appHomeUrl: getAppHomeUrl() });
  const text = [
    `Hi ${record?.contact_name || 'there'},`,
    '',
    'Thank you for your FleetNeuron AI trial request.',
    'Your request is under review and one of our sales representatives will reach out to you soon.',
    '',
    `Company: ${record?.company_name || ''}`,
    `Plan: ${PLAN_LABELS[record?.requested_plan] || record?.requested_plan || ''}`,
    '',
    `Website: ${getAppHomeUrl()}`
  ].join('\n');

  try {
    await sgMail.send({
      to,
      from: fromEmail,
      subject,
      text,
      html
    });
    return { sent: true, to: [to] };
  } catch (err) {
    const error = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    return { sent: false, reason: 'send_failed', error };
  }
}

function buildRequesterApprovedHtml(record, options = {}) {
  const appHomeUrl = options.appHomeUrl || getAppHomeUrl();
  const activationUrl = options.activationUrl || '';
  const plan = getPlan(record);
  const name = escapeHtml(record?.contact_name || 'there');
  const company = escapeHtml(record?.company_name || 'your company');
  const planName = escapeHtml(plan?.name || PLAN_LABELS[record?.requested_plan] || 'Selected Plan');
  const planDescription = escapeHtml(plan?.description || 'Your approved FleetNeuron trial plan.');
  const featureItems = Array.isArray(plan?.features) ? plan.features.slice(0, 6) : [];
  const featureList = featureItems
    .map((feature) => `<li style="margin:0 0 6px;color:#e2e8f0;font-size:14px;line-height:1.6;">${escapeHtml(feature)}</li>`)
    .join('');
  const safeActivationUrl = escapeHtml(activationUrl);

  return `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trial Request Approved</title>
  </head>
  <body style="margin:0;padding:0;background:#020617;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020617;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;border:1px solid rgba(45,212,191,.22);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%, #020617 100%);">
            <tr>
              <td style="padding:28px;background:radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 45%),radial-gradient(circle at top right, rgba(14,165,233,.18), transparent 42%);border-bottom:1px solid rgba(148,163,184,.16);">
                <h1 style="margin:0 0 8px;font-size:26px;line-height:1.2;color:#f8fafc;">Your trial request is approved</h1>
                <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">Hi ${name}, great news from FleetNeuron AI.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 14px;color:#e2e8f0;font-size:15px;line-height:1.8;">
                  Your signup request for <strong>${company}</strong> has been <strong>approved</strong>.
                </p>
                <div style="margin:0 0 18px;padding:14px 16px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(15,23,42,.58);">
                  <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;font-weight:700;margin-bottom:8px;">Approved Plan</div>
                  <div style="font-size:18px;line-height:1.4;color:#a5f3fc;font-weight:700;margin-bottom:6px;">${planName}</div>
                  <div style="font-size:14px;line-height:1.7;color:#cbd5e1;">${planDescription}</div>
                  ${featureList ? `<ul style="margin:12px 0 0;padding-left:18px;">${featureList}</ul>` : ''}
                </div>
                ${activationUrl ? `
                <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.8;">
                  Set your password and create your admin account to start your trial:
                </p>
                <a href="${safeActivationUrl}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(90deg,#22c55e,#0ea5e9);color:#ecfeff;font-weight:700;font-size:14px;text-decoration:none;">Create Trial Account</a>
                <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6;word-break:break-all;">If the button does not work, copy this link: ${safeActivationUrl}</p>
                ` : `
                <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.8;">
                  Our team will contact you with next steps shortly.
                </p>
                <a href="${escapeHtml(appHomeUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:linear-gradient(90deg,#22c55e,#0ea5e9);color:#ecfeff;font-weight:700;font-size:14px;text-decoration:none;">Open FleetNeuron</a>
                `}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendRequesterApprovedEmail(record, options = {}) {
  const { apiKey, fromEmail } = getEmailConfig();
  const to = String(record?.email || '').trim().toLowerCase();
  const activationUrl = options.activationUrl || '';
  const plan = getPlan(record);

  if (!apiKey || !fromEmail || !to) {
    return { sent: false, reason: 'email_not_configured' };
  }

  sgMail.setApiKey(apiKey);

  const subject = 'Your FleetNeuron trial request is approved';
  const html = buildRequesterApprovedHtml(record, { appHomeUrl: getAppHomeUrl(), activationUrl });
  const text = [
    `Hi ${record?.contact_name || 'there'},`,
    '',
    'Good news — your FleetNeuron AI trial signup request has been approved.',
    activationUrl
      ? 'Use the activation link below to create your trial admin account.'
      : 'Our team will reach out with next steps shortly.',
    '',
    `Company: ${record?.company_name || ''}`,
    `Plan: ${plan?.name || PLAN_LABELS[record?.requested_plan] || record?.requested_plan || ''}`,
    ...(Array.isArray(plan?.features) ? plan.features.slice(0, 5).map((f) => `- ${f}`) : []),
    ...(activationUrl ? ['', `Activation link: ${activationUrl}`] : []),
    `Website: ${getAppHomeUrl()}`
  ].join('\n');

  try {
    await sgMail.send({
      to,
      from: fromEmail,
      subject,
      text,
      html
    });
    return { sent: true, to: [to] };
  } catch (err) {
    const error = err?.response?.body?.errors?.[0]?.message || err?.message || String(err);
    return { sent: false, reason: 'send_failed', error };
  }
}

module.exports = {
  buildTrialRequestNotificationHtml,
  sendNewTrialRequestNotification,
  buildRequesterUnderReviewHtml,
  sendRequesterUnderReviewEmail,
  buildRequesterApprovedHtml,
  sendRequesterApprovedEmail
};