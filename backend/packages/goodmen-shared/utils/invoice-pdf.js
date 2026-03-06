const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// Dark theme to match website invoice page
const theme = {
  bg: '#0a0f1a',           // page background (very dark blue)
  panel: '#151b2d',       // card/panel (lighter blue)
  panelBorder: '#1e293b', // subtle panel border
  heading: '#ffffff',      // bold white headings
  label: '#94a3b8',       // section labels (BILL TO, VEHICLE / UNIT)
  text: '#e2e8f0',        // body text (light gray-white)
  highlight: '#f1f5f9',   // emphasized (customer name, unit, VIN, total)
  tableHeaderBg: '#1e293b',
  tableHeaderText: '#ffffff',
  tableRowBg: '#151b2d',
  tableRowAlt: '#0f172a',
  tableBorder: '#1e293b',
  total: '#f1f5f9',       // total amount
  paid: '#22c55e',        // green
  balanceDue: '#eab308',  // yellow
  separator: '#334155'
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  const num = Number(value || 0);
  return num.toFixed(2);
}

function buildInvoicePdf({ invoice, customer, location, workOrder, vehicle, lineItems, payments }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    let y = doc.page.margins.top;

    // ----- Full page dark background -----
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(theme.bg);

    // ----- Header: logo + INVOICE -----
    const logoPath = process.env.INVOICE_LOGO_PATH || path.join(__dirname, '..', 'assets', 'logo.png');
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, startX, y, { width: 100 });
    }

    doc.fontSize(24).fillColor(theme.heading).text('INVOICE', startX + 120, y, { width: pageWidth - 120, align: 'right' });
    y += 32;
    doc.fontSize(11).fillColor(theme.label);
    doc.text(`Invoice # ${invoice.invoice_number}`, startX + 120, y, { width: pageWidth - 120, align: 'right' });
    doc.text(`Status: ${invoice.status}`, startX + 120, y + 14, { width: pageWidth - 120, align: 'right' });
    doc.fillColor(theme.text).text(`Issued: ${formatDate(invoice.issued_date)}  ·  Due: ${formatDate(invoice.due_date)}`, startX + 120, y + 28, { width: pageWidth - 120, align: 'right' });
    y += 50;

    doc.strokeColor(theme.separator).lineWidth(1).moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 20;

    // ----- BILL TO (left) – dark panel style -----
    doc.fontSize(10).fillColor(theme.label).text('BILL TO', startX, y);
    y += 14;
    doc.fontSize(12).fillColor(theme.highlight).text(customer?.company_name || '—', startX, y);
    y += 16;
    doc.fontSize(10).fillColor(theme.text);
    if (customer?.primary_contact_name) {
      doc.text(`Contact: ${customer.primary_contact_name}`, startX, y);
      y += 14;
    }
    doc.text(customer?.billing_address_line1 || '', startX, y);
    y += 14;
    if (customer?.billing_address_line2) {
      doc.text(customer.billing_address_line2, startX, y);
      y += 14;
    }
    const cityStateZip = [customer?.billing_city, customer?.billing_state, customer?.billing_zip].filter(Boolean).join(', ');
    if (cityStateZip) {
      doc.text(cityStateZip, startX, y);
      y += 14;
    }
    if (customer?.billing_country) {
      doc.text(customer.billing_country, startX, y);
      y += 14;
    }
    if (customer?.phone) {
      doc.text(`Phone: ${customer.phone}`, startX, y);
      y += 14;
    }
    if (customer?.email) {
      doc.text(`Email: ${customer.email}`, startX, y);
      y += 14;
    }
    if (customer?.dot_number) {
      doc.text(`DOT: ${customer.dot_number}`, startX, y);
      y += 14;
    }
    y += 8;

    // ----- VEHICLE / UNIT -----
    const hasVehicleSection = workOrder || (vehicle && (vehicle.vin || vehicle.unit_number || vehicle.year || vehicle.make || vehicle.model));
    if (hasVehicleSection) {
      doc.fontSize(10).fillColor(theme.label).text('VEHICLE / UNIT', startX, y);
      y += 14;
      doc.fontSize(10).fillColor(theme.text);
      const unitNum = vehicle?.unit_number ?? '—';
      doc.fillColor(theme.highlight).text(`Unit #: ${unitNum}`, startX, y);
      y += 14;
      const vin = vehicle?.vin ?? '—';
      doc.fillColor(theme.highlight).text(`VIN: ${vin}`, startX, y);
      y += 14;
      doc.fillColor(theme.text);
      if (vehicle?.year || vehicle?.make || vehicle?.model) {
        const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
        if (ymm) {
          doc.text(ymm, startX, y);
          y += 14;
        }
      }
      if (workOrder?.work_order_number) {
        doc.text(`Work Order: ${workOrder.work_order_number}`, startX, y);
        y += 14;
      }
      y += 12;
    }

    // ----- INVOICE DETAILS / SERVICE LOCATION (right column) -----
    const rightColX = startX + pageWidth * 0.52;
    let rightY = doc.page.margins.top + 20;
    doc.fontSize(10).fillColor(theme.label).text('SERVICE LOCATION', rightColX, rightY);
    rightY += 14;
    doc.fontSize(10).fillColor(theme.text).text(location?.name || '—', rightColX, rightY);
    rightY += 14;
    if (location?.address) {
      doc.text(location.address, rightColX, rightY, { width: pageWidth * 0.45 });
      rightY += 24;
    } else rightY += 8;

    doc.fontSize(10).fillColor(theme.label).text('PAYMENT TERMS', rightColX, rightY);
    rightY += 14;
    doc.fontSize(10).fillColor(theme.text).text(invoice.payment_terms || '—', rightColX, rightY);
    rightY += 20;

    y = Math.max(y, rightY) + 10;

    // ----- Financial summary bar (TOTAL | PAID | BALANCE DUE) -----
    const summaryY = y;
    const summaryH = 36;
    doc.fillColor(theme.panel).strokeColor(theme.panelBorder).rect(startX, summaryY, pageWidth, summaryH).fillAndStroke();
    const third = pageWidth / 3;
    doc.fontSize(10).fillColor(theme.label);
    doc.text('TOTAL', startX + 16, summaryY + 10);
    doc.text('PAID', startX + third + 16, summaryY + 10);
    doc.text('BALANCE DUE', startX + third * 2 + 16, summaryY + 10);
    doc.fontSize(12).fillColor(theme.total).text(`$${formatMoney(invoice.total_amount)}`, startX + 16, summaryY + 22);
    doc.fillColor(theme.paid).text(`$${formatMoney(invoice.amount_paid)}`, startX + third + 16, summaryY + 22);
    doc.fillColor(theme.balanceDue).text(`$${formatMoney(invoice.balance_due)}`, startX + third * 2 + 16, summaryY + 22);
    y = summaryY + summaryH + 18;

    // ----- Line items table (dark theme) -----
    doc.fontSize(10).fillColor(theme.label).text('LINE ITEMS', startX, y);
    y += 18;

    const tableTop = y;
    const rowHeight = 22;
    const colX = [startX, startX + 58, startX + 300, startX + 368, startX + 438];
    const colW = [58, 242, 68, 70, 82];

    doc.fillColor(theme.tableHeaderBg).strokeColor(theme.tableBorder).rect(startX, tableTop, pageWidth, rowHeight).fillAndStroke();
    doc.fillColor(theme.tableHeaderText).fontSize(9);
    doc.text('Type', colX[0] + 4, tableTop + 6, { width: colW[0] });
    doc.text('Description', colX[1] + 4, tableTop + 6, { width: colW[1] });
    doc.text('Qty', colX[2], tableTop + 6, { width: colW[2], align: 'right' });
    doc.text('Unit $', colX[3], tableTop + 6, { width: colW[3], align: 'right' });
    doc.text('Total', colX[4], tableTop + 6, { width: colW[4], align: 'right' });

    y = tableTop + rowHeight;
    (lineItems || []).forEach((item, i) => {
      const rowBg = i % 2 === 0 ? theme.tableRowBg : theme.tableRowAlt;
      doc.fillColor(rowBg).rect(startX, y, pageWidth, rowHeight).fill();
      doc.strokeColor(theme.tableBorder).rect(startX, y, pageWidth, rowHeight).stroke();
      doc.fillColor(theme.text).fontSize(10);
      doc.text(item.line_type || '', colX[0] + 4, y + 6, { width: colW[0] });
      doc.text(item.description || '', colX[1] + 4, y + 6, { width: colW[1] });
      doc.text(formatMoney(item.quantity || 0), colX[2], y + 6, { width: colW[2], align: 'right' });
      doc.text(formatMoney(item.unit_price || 0), colX[3], y + 6, { width: colW[3], align: 'right' });
      doc.text(formatMoney(item.line_total || 0), colX[4], y + 6, { width: colW[4], align: 'right' });
      y += rowHeight;
    });

    // ----- Totals panel (dark) -----
    const totalsX = startX + pageWidth - 240;
    const totalsTop = y + 16;
    const totH = 132;
    doc.fillColor(theme.panel).strokeColor(theme.panelBorder).rect(totalsX, totalsTop, 240, totH).fillAndStroke();
    doc.fillColor(theme.text).fontSize(10);
    doc.text(`Labor: $${formatMoney(invoice.subtotal_labor)}`, totalsX + 12, totalsTop + 12);
    doc.text(`Parts: $${formatMoney(invoice.subtotal_parts)}`, totalsX + 12, totalsTop + 28);
    doc.text(`Fees: $${formatMoney(invoice.subtotal_fees)}`, totalsX + 12, totalsTop + 44);
    doc.text(`Discount: $${formatMoney(invoice.discount_value)} (${invoice.discount_type || 'NONE'})`, totalsX + 12, totalsTop + 60, { width: 216 });
    doc.text(`Tax: $${formatMoney(invoice.tax_amount)} (${invoice.tax_rate_percent || 0}%)`, totalsX + 12, totalsTop + 76);
    doc.fontSize(12).fillColor(theme.total).text(`Total: $${formatMoney(invoice.total_amount)}`, totalsX + 12, totalsTop + 96);
    doc.fontSize(10).fillColor(theme.paid).text(`Paid: $${formatMoney(invoice.amount_paid)}`, totalsX + 12, totalsTop + 114);
    doc.fontSize(11).fillColor(theme.balanceDue).text(`Balance Due: $${formatMoney(invoice.balance_due)}`, totalsX + 12, totalsTop + 128);

    y = totalsTop + totH + 20;

    // ----- Payments -----
    if (payments?.length) {
      doc.fontSize(10).fillColor(theme.label).text('PAYMENTS', startX, y);
      y += 16;
      doc.fontSize(10).fillColor(theme.text);
      payments.forEach(p => {
        doc.text(`${formatDate(p.payment_date)}  ${p.method}  $${formatMoney(p.amount)}  ${p.reference_number || ''}`, startX, y);
        y += 14;
      });
      y += 12;
    }

    // ----- Notes -----
    if (invoice.notes) {
      doc.fontSize(10).fillColor(theme.label).text('NOTES', startX, y);
      y += 14;
      doc.fontSize(10).fillColor(theme.text).text(invoice.notes, startX, y, { width: pageWidth });
    }

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
