const PDFDocument = require('pdfkit');

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value);
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text;
  return d.toISOString().slice(0, 10);
}

function fmtMoney(value) {
  return Number(value || 0).toFixed(2);
}

function safeToken(value, fallback = 'UNKNOWN') {
  const raw = (value || '').toString().trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || fallback;
}

function getDriverName(driver) {
  return [driver?.first_name, driver?.last_name].filter(Boolean).join(' ').trim() || 'Driver';
}

function getPeriodLabel(period, settlement) {
  return `${fmtDate(period?.period_start || settlement?.period_start)} → ${fmtDate(period?.period_end || settlement?.period_end || settlement?.date)}`;
}

function getSettlementNumberDisplay(settlement, driver, period) {
  const driverToken = safeToken(getDriverName(driver), 'DRIVER');
  const start = fmtDate(period?.period_start || settlement?.period_start);
  const end = fmtDate(period?.period_end || settlement?.period_end || settlement?.date);
  const periodToken = safeToken(`${start}_TO_${end}`, 'NO_PERIOD');
  return `STL-${driverToken}-${periodToken}`;
}

function drawCard(doc, x, y, w, h, title) {
  doc.save();
  doc.roundedRect(x, y, w, h, 8).fillAndStroke('#f8fafc', '#dbe7ff');
  doc.restore();
  doc.fontSize(12).fillColor('#0f172a').text(title, x + 12, y + 10);
}

function buildSettlementPdf({ settlement, driver, period, primaryPayee, additionalPayee, loadItems, adjustmentItems }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const top = doc.page.margins.top;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const title = `Settlement ${getPeriodLabel(period, settlement)}`;
    const settlementNumber = getSettlementNumberDisplay(settlement, driver, period);

    doc.fontSize(20).fillColor('#0b1e4b').text(title, left, top, { width: pageWidth });
    doc.fontSize(10).fillColor('#334155').text(`Settlement #: ${settlementNumber}`, left, top + 26, { width: pageWidth });
    doc.text(`Generated: ${new Date().toISOString()}`, left, top + 40, { width: pageWidth });

    const gap = 14;
    const colW = (pageWidth - gap) / 2;
    let y = top + 64;

    // Compensation summary card
    drawCard(doc, left, y, colW, 152, 'Compensation Summary');
    let sy = y + 34;
    doc.fontSize(10).fillColor('#1f2937');
    doc.text(`Driver: ${getDriverName(driver)}`, left + 12, sy, { width: colW - 24 }); sy += 16;
    doc.text(`Payroll period: ${getPeriodLabel(period, settlement)}`, left + 12, sy, { width: colW - 24 }); sy += 16;
    doc.text(`Primary payee: ${primaryPayee?.name || settlement?.primary_payee_id || '—'}`, left + 12, sy, { width: colW - 24 }); sy += 16;
    doc.text(`Additional payee: ${additionalPayee?.name || settlement?.additional_payee_id || '—'}`, left + 12, sy, { width: colW - 24 }); sy += 16;
    doc.text(`Status: ${settlement?.settlement_status || 'preparing'}`, left + 12, sy, { width: colW - 24 });

    // Totals card
    drawCard(doc, left + colW + gap, y, colW, 152, 'Totals');
    let ty = y + 34;
    doc.fontSize(10).fillColor('#1f2937');
    doc.text(`Gross: $${fmtMoney(settlement?.subtotal_gross)}`, left + colW + gap + 12, ty); ty += 16;
    doc.text(`Driver pay subtotal: $${fmtMoney(settlement?.subtotal_driver_pay)}`, left + colW + gap + 12, ty); ty += 16;
    doc.text(`Additional payee subtotal: $${fmtMoney(settlement?.subtotal_additional_payee)}`, left + colW + gap + 12, ty); ty += 16;
    doc.text(`Total deductions: $${fmtMoney(settlement?.total_deductions)}`, left + colW + gap + 12, ty); ty += 16;
    doc.text(`Net driver pay: $${fmtMoney(settlement?.net_pay_driver)}`, left + colW + gap + 12, ty); ty += 16;
    doc.text(`Net additional payee: $${fmtMoney(settlement?.net_pay_additional_payee)}`, left + colW + gap + 12, ty);

    y += 152 + gap;

    // Load earnings card
    const loadCardH = Math.max(110, 56 + Math.min((loadItems || []).length, 12) * 16);
    drawCard(doc, left, y, pageWidth, loadCardH, `Load Earnings (${(loadItems || []).length})`);
    let ly = y + 34;
    doc.fontSize(9).fillColor('#1f2937');
    if ((loadItems || []).length) {
      (loadItems || []).slice(0, 12).forEach((item) => {
        doc.text(
          `${item?.load_number || item?.load_id || '—'} | ${fmtDate(item?.pickup_date)} → ${fmtDate(item?.delivery_date)} | Gross $${fmtMoney(item?.gross_amount)} | Driver $${fmtMoney(item?.driver_pay_amount)} | Additional $${fmtMoney(item?.additional_payee_amount)}`,
          left + 12,
          ly,
          { width: pageWidth - 24 }
        );
        ly += 16;
      });
      if ((loadItems || []).length > 12) {
        doc.fillColor('#64748b').text(`…and ${(loadItems || []).length - 12} more load item(s)`, left + 12, ly, { width: pageWidth - 24 });
      }
    } else {
      doc.text('No load earnings.', left + 12, ly, { width: pageWidth - 24 });
    }

    y += loadCardH + gap;

    // Manual adjustments card
    const manualAdjustments = (adjustmentItems || []).filter((x) => (x?.source_type || 'manual') === 'manual');
    const adjCardH = Math.max(110, 56 + Math.min(manualAdjustments.length, 12) * 16);
    if (y + adjCardH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    drawCard(doc, left, y, pageWidth, adjCardH, `Manual Adjustments (${manualAdjustments.length})`);
    let ay = y + 34;
    doc.fontSize(9).fillColor('#1f2937');
    if (manualAdjustments.length) {
      manualAdjustments.slice(0, 12).forEach((item) => {
        doc.text(
          `${item?.item_type || 'deduction'} | ${item?.description || '—'} | $${fmtMoney(item?.amount)} | apply: ${item?.apply_to || 'primary_payee'}`,
          left + 12,
          ay,
          { width: pageWidth - 24 }
        );
        ay += 16;
      });
      if (manualAdjustments.length > 12) {
        doc.fillColor('#64748b').text(`…and ${manualAdjustments.length - 12} more manual adjustment(s)`, left + 12, ay, { width: pageWidth - 24 });
      }
    } else {
      doc.text('No manual adjustments.', left + 12, ay, { width: pageWidth - 24 });
    }

    doc.end();
  });
}

module.exports = { buildSettlementPdf };
