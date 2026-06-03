function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function fmtMoney(value) {
  return asNumber(value).toFixed(2);
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value);
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toISOString().slice(0, 10);
}

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

function getDriverName(driver) {
  return [driver?.first_name, driver?.last_name].filter(Boolean).join(' ').trim() || 'Driver';
}

function getPayableTo(payload) {
  if (payload?.settlement?.settlement_type === 'equipment_owner') {
    return safeText(payload?.equipmentOwner?.name || payload?.primaryPayee?.name, 'Equipment Owner');
  }
  return safeText(payload?.primaryPayee?.name || getDriverName(payload?.driver), 'Driver');
}

function getSettlementTypeLabel(settlementType) {
  return settlementType === 'equipment_owner' ? 'Equipment Owner Settlement' : 'Driver Settlement';
}

function getPrimaryRecipient(payload, options = {}) {
  const settlementType = payload?.settlement?.settlement_type;
  if (settlementType === 'equipment_owner') {
    if (!options.to_driver) return null;
    const email = payload?.equipmentOwner?.email || payload?.primaryPayee?.email || null;
    return email ? { email, role: 'equipment_owner_payee' } : null;
  }

  if (!options.to_driver) return null;
  const email = payload?.driver?.email || null;
  return email ? { email, role: 'driver' } : null;
}

function getSecondaryRecipient(payload, options = {}) {
  const settlementType = payload?.settlement?.settlement_type;
  if (!options.to_additional_payee) return null;

  if (settlementType === 'equipment_owner') {
    const email = payload?.driver?.email || null;
    return email ? { email, role: 'driver_reference' } : null;
  }

  const email = payload?.equipmentOwner?.email || payload?.additionalPayee?.email || null;
  return email ? { email, role: 'equipment_owner' } : null;
}

function resolveSettlementEmailRecipients(payload, options = {}) {
  const recipients = [];
  const seen = new Set();

  for (const candidate of [getPrimaryRecipient(payload, options), getSecondaryRecipient(payload, options)]) {
    if (!candidate) continue;
    const key = candidate.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(candidate);
  }

  return recipients;
}

function resolveSettlementInternalCc(options = {}) {
  if (!options.cc_internal) return [];
  return parseRecipientList(
    process.env.SETTLEMENT_EMAIL_INTERNAL_CC
    || process.env.SETTLEMENT_EMAIL_INTERNAL_CC_EMAILS
    || process.env.SETTLEMENT_INTERNAL_CC_EMAILS
  );
}

function buildSettlementEmailContent(payload) {
  const settlement = payload?.settlement || {};
  const typeLabel = getSettlementTypeLabel(settlement.settlement_type);
  const payableTo = getPayableTo(payload);
  const settlementNumber = safeText(settlement.settlement_number);
  const periodLabel = `${fmtDate(payload?.period?.period_start || settlement?.period_start)} to ${fmtDate(payload?.period?.period_end || settlement?.period_end || settlement?.date)}`;
  const netPay = settlement.settlement_type === 'equipment_owner'
    ? asNumber(settlement.net_pay_additional_payee)
    : asNumber(settlement.net_pay_driver);
  const loadCount = Array.isArray(payload?.loadItems) ? payload.loadItems.length : 0;

  const subject = `${typeLabel} ${settlementNumber}`;
  const text = [
    `${typeLabel}`,
    '',
    `Payable To: ${payableTo}`,
    `Settlement #: ${settlementNumber}`,
    `Settlement Date: ${fmtDate(settlement.date)}`,
    `Payroll Period: ${periodLabel}`,
    `Net Pay: $${fmtMoney(netPay)}`,
    `Load Count: ${loadCount}`,
    '',
    'The settlement PDF is attached.',
    '',
    '— FleetNeuron AI'
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#020617;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;border:1px solid rgba(45,212,191,.22);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#0f172a 0%, #020617 100%);">
      <tr>
        <td style="padding:28px;background:radial-gradient(circle at top left, rgba(34,197,94,.16), transparent 45%),radial-gradient(circle at top right, rgba(14,165,233,.18), transparent 42%);border-bottom:1px solid rgba(148,163,184,.16);">
          <div style="display:inline-block;padding:6px 12px;border:1px solid rgba(45,212,191,.35);border-radius:999px;background:rgba(45,212,191,.1);font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:#99f6e4;">FleetNeuron AI</div>
          <h1 style="margin:14px 0 8px;font-size:26px;line-height:1.2;color:#f8fafc;">${escapeHtml(typeLabel)}</h1>
          <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.7;">Your settlement report is attached as a PDF.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Payable To</td>
              <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(payableTo)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Settlement #</td>
              <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(settlementNumber)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Settlement Date</td>
              <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(fmtDate(settlement.date))}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Payroll Period</td>
              <td style="padding:8px 0;color:#f8fafc;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(periodLabel)}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Net Pay</td>
              <td style="padding:8px 0;color:#a7f3d0;font-size:16px;font-weight:700;text-align:right;">$${escapeHtml(fmtMoney(netPay))}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#94a3b8;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Load Count</td>
              <td style="padding:8px 0;color:#cbd5e1;font-size:14px;text-align:right;">${escapeHtml(String(loadCount))}</td>
            </tr>
          </table>
          <p style="margin:20px 0 0;color:#cbd5e1;font-size:14px;line-height:1.7;">The full settlement report PDF is attached to this email.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;border-top:1px solid rgba(148,163,184,.14);color:#64748b;font-size:12px;">Powered by FleetNeuron AI</td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

async function sendSettlementEmailReport({ payload, options, pdfBuffer, fileName }) {
  const { sendEmail } = require('./notification-service');
  const recipients = resolveSettlementEmailRecipients(payload, options);
  if (!recipients.length) {
    return { sent: false, reason: 'no_recipients', error: 'Select at least one recipient with a valid email address.' };
  }

  const { subject, text, html } = buildSettlementEmailContent(payload);
  const cc = resolveSettlementInternalCc(options);
  const result = await sendEmail({
    to: recipients.map((entry) => entry.email),
    cc,
    subject,
    text,
    html,
    attachments: [
      {
        content: Buffer.from(pdfBuffer).toString('base64'),
        filename: fileName,
        type: 'application/pdf',
        disposition: 'attachment'
      }
    ]
  });

  return {
    ...result,
    recipients,
    ccRecipients: cc
  };
}

module.exports = {
  buildSettlementEmailContent,
  resolveSettlementEmailRecipients,
  resolveSettlementInternalCc,
  sendSettlementEmailReport
};
