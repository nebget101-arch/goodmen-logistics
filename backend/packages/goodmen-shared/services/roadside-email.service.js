/**
 * SendGrid Service: Send emails for roadside incident management
 * Handles call creation notifications, dispatch assignments, resolutions, and status updates
 *
 * Env vars (required):
 *   SENDGRID_API_KEY - SendGrid API key
 *   SENDGRID_FROM_EMAIL - Email address to send from (e.g., "FleetNeuron AI <alerts@fleetneuron.ai>")
 */

const sgMail = require('@sendgrid/mail');
const dtLogger = require('../utils/logger');

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'FleetNeuron AI <roadside@fleetneuron.ai>';

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
}

/**
 * Send email via SendGrid
 * @param {object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text body
 * @param {string} [options.html] - HTML body
 * @param {string} [options.replyTo] - Reply-to email
 * @returns {Promise<{ sent: boolean, messageId?: string, error?: string }>}
 */
async function sendEmail(options) {
  if (!SENDGRID_KEY) {
    return {
      sent: false,
      error: 'SendGrid not configured (set SENDGRID_API_KEY)'
    };
  }

  const { to, subject, text, html, replyTo } = options || {};
  if (!to || !subject) {
    return { sent: false, error: 'Missing to or subject' };
  }

  try {
    const msg = {
      to,
      from: FROM_EMAIL,
      subject,
      text: text || '',
      html: html || (text ? text.replace(/\n/g, '<br>') : ''),
      replyTo: replyTo || undefined
    };

    const result = await sgMail.send(msg);
    const messageId = result[0]?.headers?.['x-message-id'];

    dtLogger.info(`SendGrid: Email sent to ${to} (subject: "${subject}") - MsgId: ${messageId}`);
    return { sent: true, messageId };
  } catch (err) {
    const errorMsg = err.response?.body?.errors?.[0]?.message || err.message || String(err);
    dtLogger.error(`SendGrid send error: ${errorMsg}`);
    return { sent: false, error: errorMsg };
  }
}

/**
 * Send roadside call creation notification to dispatcher
 * @param {object} params
 * @param {string} params.dispatcherEmail - Dispatcher email
 * @param {string} params.callNumber - Roadside call number
 * @param {string} params.callerName - Caller name
 * @param {string} params.callerPhone - Caller phone
 * @param {string} params.issueType - Issue type/category
 * @param {string} [params.urgency] - Urgency level (critical, high, medium, low)
 * @param {string} [params.location] - Incident location
 * @param {string} [params.dispatcherUrl] - Link to dispatcher console
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendCallCreatedNotification({
  dispatcherEmail,
  callNumber,
  callerName,
  callerPhone,
  issueType,
  urgency,
  location,
  dispatcherUrl
}) {
  const urgencyLabel = urgency ? `[${urgency.toUpperCase()}]` : '';
  const subject = `🚨 New Roadside Call ${urgencyLabel}: ${callNumber}`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #2563eb;">New Roadside Incident Call</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold; width: 30%;">Call Number:</td>
          <td style="padding: 12px;">${escapeHtml(callNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; font-weight: bold;">Caller:</td>
          <td style="padding: 12px;">${escapeHtml(callerName)} (${escapeHtml(callerPhone)})</td>
        </tr>
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold;">Issue Type:</td>
          <td style="padding: 12px;">${escapeHtml(issueType)}</td>
        </tr>
        ${urgency ? `<tr>
          <td style="padding: 12px; font-weight: bold;">Urgency:</td>
          <td style="padding: 12px;"><span style="background: ${getUrgencyColor(urgency)}; color: white; padding: 4px 8px; border-radius: 4px;">${urgency.toUpperCase()}</span></td>
        </tr>` : ''}
        ${location ? `<tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold;">Location:</td>
          <td style="padding: 12px;">${escapeHtml(location)}</td>
        </tr>` : ''}
      </table>
      <div style="margin-top: 20px;">
        ${dispatcherUrl ? `<a href="${escapeHtml(dispatcherUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">View in Dispatcher</a>` : ''}
      </div>
      <p style="color: #666; margin-top: 20px; font-size: 12px;">— FleetNeuron AI Roadside Support</p>
    </div>
  `;

  const text = `New Roadside Incident Call: ${callNumber}
Caller: ${callerName} (${callerPhone})
Issue Type: ${issueType}
${urgency ? `Urgency: ${urgency}` : ''}
${location ? `Location: ${location}` : ''}
${dispatcherUrl ? `\nOpen dispatcher: ${dispatcherUrl}` : ''}`;

  return sendEmail({
    to: dispatcherEmail,
    subject,
    text,
    html
  });
}

/**
 * Send dispatch assignment notification to all relevant contacts
 * @param {object} params
 * @param {string} params.driverEmail - Driver email
 * @param {string} params.driverPhone - Driver phone (for SMS via separate service)
 * @param {string} params.callNumber - Roadside call number
 * @param {string} params.vendorName - Assigned vendor/dispatch service name
 * @param {string} params.vendorPhone - Vendor phone number
 * @param {string} params.eta - Estimated time of arrival
 * @param {string} [params.vendorEmail] - Vendor email
 * @param {string} [params.publicPortalUrl] - Link to public driver portal
 * @returns {Promise<{ driverEmail: { sent: boolean, error?: string }, vendorEmail?: { sent: boolean, error?: string } }>}
 */
async function sendDispatchAssignedNotification({
  driverEmail,
  driverPhone,
  callNumber,
  vendorName,
  vendorPhone,
  eta,
  vendorEmail,
  publicPortalUrl
}) {
  const result = { driverEmail: { sent: false }, vendorEmail: { sent: false } };

  // Notify driver
  if (driverEmail) {
    const driverHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #2563eb;">Help is on the Way! 🚗</h2>
        <p>We've dispatched a service provider to assist you with your roadside incident.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f3f4f6;">
            <td style="padding: 12px; font-weight: bold; width: 30%;">Service Provider:</td>
            <td style="padding: 12px;">${escapeHtml(vendorName)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold;">Contact Number:</td>
            <td style="padding: 12px;">${escapeHtml(vendorPhone)}</td>
          </tr>
          <tr style="background: #f3f4f6;">
            <td style="padding: 12px; font-weight: bold;">Estimated Arrival:</td>
            <td style="padding: 12px;">${escapeHtml(eta)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold;">Call Number:</td>
            <td style="padding: 12px;">${escapeHtml(callNumber)}</td>
          </tr>
        </table>
        <div style="margin-top: 20px; background: #eff6ff; padding: 12px; border-left: 4px solid #2563eb; border-radius: 4px;">
          <p style="margin: 0; color: #1e40af;"><strong>Next steps:</strong></p>
          <ul style="margin: 8px 0; padding-left: 20px; color: #1e40af;">
            <li>Stay at your vehicle and look for the service provider</li>
            <li>Have your call number ready: ${escapeHtml(callNumber)}</li>
            <li>If you need to update your status, use the driver portal</li>
          </ul>
        </div>
        ${publicPortalUrl ? `<div style="margin-top: 20px; text-align: center;">
          <a href="${escapeHtml(publicPortalUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">Update Your Status</a>
        </div>` : ''}
        <p style="color: #666; margin-top: 20px; font-size: 12px;">— FleetNeuron AI Roadside Support</p>
      </div>
    `;

    const driverText = `Help is on the Way!
Service Provider: ${vendorName}
Contact Number: ${vendorPhone}
Estimated Arrival: ${eta}
Call Number: ${callNumber}

Stay at your vehicle and look for the service provider.
${publicPortalUrl ? `\nUpdate your status: ${publicPortalUrl}` : ''}`;

    result.driverEmail = await sendEmail({
      to: driverEmail,
      subject: `Dispatch Confirmed for Call ${callNumber} - Help Arriving Soon`,
      text: driverText,
      html: driverHtml
    });
  }

  // Notify vendor/dispatcher
  if (vendorEmail) {
    const vendorHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: #2563eb;">New Dispatch Assignment</h2>
        <p>You have been assigned to a roadside incident call.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f3f4f6;">
            <td style="padding: 12px; font-weight: bold; width: 30%;">Call Number:</td>
            <td style="padding: 12px;">${escapeHtml(callNumber)}</td>
          </tr>
          <tr>
            <td style="padding: 12px; font-weight: bold;">Driver Phone:</td>
            <td style="padding: 12px;">${escapeHtml(driverPhone)}</td>
          </tr>
          <tr style="background: #f3f4f6;">
            <td style="padding: 12px; font-weight: bold;">Assigned ETA:</td>
            <td style="padding: 12px;">${escapeHtml(eta)}</td>
          </tr>
        </table>
        <p style="color: #666; margin-top: 20px; font-size: 12px;">— FleetNeuron AI Roadside Support</p>
      </div>
    `;

    const vendorText = `New Dispatch Assignment
Call Number: ${callNumber}
Driver Phone: ${driverPhone}
Assigned ETA: ${eta}`;

    result.vendorEmail = await sendEmail({
      to: vendorEmail,
      subject: `New Assignment: Roadside Call ${callNumber}`,
      text: vendorText,
      html: vendorHtml
    });
  }

  return result;
}

/**
 * Send call resolution notification
 * @param {object} params
 * @param {string} params.driverEmail - Driver email
 * @param {string} params.callNumber - Roadside call number
 * @param {string} [params.resolutionNotes] - Notes on how issue was resolved
 * @param {string} [params.dispatcherEmail] - Dispatcher email for copy
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendCallResolvedNotification({
  driverEmail,
  callNumber,
  resolutionNotes,
  dispatcherEmail
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #16a34a;">✓ Your Roadside Call is Resolved</h2>
      <p>Thank you for using FleetNeuron AI Roadside Support. Your incident has been successfully addressed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold; width: 30%;">Call Number:</td>
          <td style="padding: 12px;">${escapeHtml(callNumber)}</td>
        </tr>
        ${resolutionNotes ? `<tr>
          <td style="padding: 12px; font-weight: bold; vertical-align: top;">Resolution Notes:</td>
          <td style="padding: 12px;">${escapeHtml(resolutionNotes)}</td>
        </tr>` : ''}
      </table>
      <div style="margin-top: 20px; background: #f0fdf4; padding: 12px; border-left: 4px solid #16a34a; border-radius: 4px;">
        <p style="margin: 0; color: #15803d;">If you need further assistance, please don't hesitate to contact us.</p>
      </div>
      <p style="color: #666; margin-top: 20px; font-size: 12px;">— FleetNeuron AI Roadside Support</p>
    </div>
  `;

  const text = `Your Roadside Call is Resolved
Call Number: ${callNumber}
${resolutionNotes ? `\nResolution Notes:\n${resolutionNotes}` : ''}

Thank you for using FleetNeuron AI Roadside Support.`;

  const result = await sendEmail({
    to: driverEmail,
    subject: `Roadside Call ${callNumber} - Resolved ✓`,
    text,
    html
  });

  // Optionally CC dispatcher
  if (dispatcherEmail && result.sent) {
    await sendEmail({
      to: dispatcherEmail,
      subject: `[RESOLVED] Roadside Call ${callNumber}`,
      text: `Call ${callNumber} has been marked as resolved.${resolutionNotes ? `\n\nNotes:\n${resolutionNotes}` : ''}`,
      html: `<p>Call <strong>${escapeHtml(callNumber)}</strong> has been marked as resolved.</p>${resolutionNotes ? `<p>${escapeHtml(resolutionNotes)}</p>` : ''}`
    });
  }

  return result;
}

/**
 * Send payment contact notification (when driver provides payment info)
 * @param {object} params
 * @param {string} params.paymentEmail - Payment contact email
 * @param {string} params.callNumber - Roadside call number
 * @param {string} params.companyName - Driver's company name
 * @param {string} [params.estimatedCost] - Estimated service cost
 * @param {string} [params.invoiceUrl] - Link to invoice
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
async function sendPaymentContactNotification({
  paymentEmail,
  callNumber,
  companyName,
  estimatedCost,
  invoiceUrl
}) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #2563eb;">Roadside Service Billing Notification</h2>
      <p>A roadside incident service has been completed for your company.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold; width: 30%;">Call Number:</td>
          <td style="padding: 12px;">${escapeHtml(callNumber)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; font-weight: bold;">Company:</td>
          <td style="padding: 12px;">${escapeHtml(companyName)}</td>
        </tr>
        ${estimatedCost ? `<tr style="background: #f3f4f6;">
          <td style="padding: 12px; font-weight: bold;">Estimated Cost:</td>
          <td style="padding: 12px;">${escapeHtml(estimatedCost)}</td>
        </tr>` : ''}
      </table>
      ${invoiceUrl ? `<div style="margin-top: 20px; text-align: center;">
        <a href="${escapeHtml(invoiceUrl)}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold;">View Invoice</a>
      </div>` : ''}
      <p style="color: #666; margin-top: 20px; font-size: 12px;">— FleetNeuron AI Billing</p>
    </div>
  `;

  const text = `Roadside Service Billing Notification
Call Number: ${callNumber}
Company: ${companyName}
${estimatedCost ? `Estimated Cost: ${estimatedCost}` : ''}
${invoiceUrl ? `\nView Invoice: ${invoiceUrl}` : ''}`;

  return sendEmail({
    to: paymentEmail,
    subject: `Invoice for Roadside Service Call ${callNumber}`,
    text,
    html
  });
}

/**
 * Get urgency color for HTML email
 * @param {string} urgency
 * @returns {string} Hex color
 */
function getUrgencyColor(urgency) {
  const colors = {
    critical: '#dc2626',
    high: '#f59e0b',
    medium: '#3b82f6',
    low: '#10b981'
  };
  return colors[urgency?.toLowerCase()] || '#6b7280';
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  sendEmail,
  sendCallCreatedNotification,
  sendDispatchAssignedNotification,
  sendCallResolvedNotification,
  sendPaymentContactNotification,
  isConfigured: () => !!SENDGRID_KEY
};
