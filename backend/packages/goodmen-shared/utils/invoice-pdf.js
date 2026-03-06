const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// White background theme; dark text for readability
const theme = {
  bg: '#ffffff',
  panel: '#f8fafc',
  panelBorder: '#e2e8f0',
  heading: '#0f172a',
  label: '#475569',
  text: '#334155',
  highlight: '#0f172a',
  tableHeaderBg: '#f1f5f9',
  tableHeaderText: '#0f172a',
  tableRowBg: '#ffffff',
  tableRowAlt: '#f8fafc',
  tableBorder: '#e2e8f0',
  total: '#0f172a',
  paid: '#16a34a',
  balanceDue: '#ca8a04',
  separator: '#e2e8f0'
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

    // ----- White background -----
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(theme.bg);

    // ----- Header: left = Invoice # + Service location; right = Status, Issued, Due, Payment terms -----
    const logoPath = process.env.INVOICE_LOGO_PATH || path.join(__dirname, '..', 'assets', 'logo.png');
    if (logoPath && fs.existsSync(logoPath)) {
      doc.image(logoPath, startX, y, { width: 80 });
    }

    const headerLeftW = pageWidth * 0.5;
    const headerRightX = startX + headerLeftW;
    const headerRightW = pageWidth - headerLeftW;

    doc.fontSize(22).fillColor(theme.heading).text('INVOICE', startX, y, { width: headerLeftW });
    y += 26;
    doc.fontSize(11).fillColor(theme.label).text('Invoice #', startX, y);
    doc.fontSize(11).fillColor(theme.highlight).text(invoice.invoice_number || '—', startX + 52, y, { width: headerLeftW - 52 });
    y += 16;
    doc.fontSize(10).fillColor(theme.label).text('Service location', startX, y);
    doc.fontSize(10).fillColor(theme.text).text(location?.name || '—', startX + 72, y, { width: headerLeftW - 72 });
    const headerLeftBottom = y + 14;

    // Right side of header: Status, Issued, Due, Payment terms
    let rightY = doc.page.margins.top;
    doc.fontSize(10).fillColor(theme.label).text(`Status: ${invoice.status || '—'}`, headerRightX, rightY, { width: headerRightW, align: 'right' });
    rightY += 16;
    doc.fontSize(10).fillColor(theme.label).text(`Issued: ${formatDate(invoice.issued_date)}`, headerRightX, rightY, { width: headerRightW, align: 'right' });
    rightY += 16;
    doc.fontSize(10).fillColor(theme.label).text(`Due: ${formatDate(invoice.due_date)}`, headerRightX, rightY, { width: headerRightW, align: 'right' });
    rightY += 16;
    doc.fontSize(10).fillColor(theme.label).text(`Payment terms: ${invoice.payment_terms || '—'}`, headerRightX, rightY, { width: headerRightW, align: 'right' });
    rightY += 18;

    y = Math.max(headerLeftBottom, rightY) + 4;
    doc.strokeColor(theme.separator).lineWidth(1).moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 20;

    // ----- 2x2 grid: BILL TO (left) | VEHICLE / UNIT (right) -----
    const gridY = y;
    const halfW = (pageWidth - 16) / 2;
    const leftColX = startX;
    const rightColX = startX + halfW + 16;
    let leftY = gridY;
    let rightYGrid = gridY;

    // Left column: BILL TO
    doc.fontSize(10).fillColor(theme.label).text('BILL TO', leftColX, leftY);
    leftY += 14;
    doc.fontSize(12).fillColor(theme.highlight).text(customer?.company_name || '—', leftColX, leftY, { width: halfW - 4 });
    leftY += 16;
    doc.fontSize(10).fillColor(theme.text);
    if (customer?.primary_contact_name) {
      doc.text(`Contact: ${customer.primary_contact_name}`, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.billing_address_line1) {
      doc.text(customer.billing_address_line1, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.billing_address_line2) {
      doc.text(customer.billing_address_line2, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    const cityStateZip = [customer?.billing_city, customer?.billing_state, customer?.billing_zip].filter(Boolean).join(', ');
    if (cityStateZip) {
      doc.text(cityStateZip, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.billing_country) {
      doc.text(customer.billing_country, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.phone) {
      doc.text(`Phone: ${customer.phone}`, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.email) {
      doc.text(`Email: ${customer.email}`, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    if (customer?.dot_number) {
      doc.text(`DOT: ${customer.dot_number}`, leftColX, leftY, { width: halfW - 4 });
      leftY += 14;
    }
    leftY += 8;

    // Right column: VEHICLE / UNIT
    const hasVehicleSection = workOrder || (vehicle && (vehicle.vin || vehicle.unit_number || vehicle.year || vehicle.make || vehicle.model));
    if (hasVehicleSection) {
      doc.fontSize(10).fillColor(theme.label).text('VEHICLE / UNIT', rightColX, rightYGrid);
      rightYGrid += 14;
      doc.fontSize(10).fillColor(theme.text);
      const unitNum = vehicle?.unit_number ?? '—';
      doc.fillColor(theme.highlight).text(`Unit #: ${unitNum}`, rightColX, rightYGrid, { width: halfW - 4 });
      rightYGrid += 14;
      const vin = vehicle?.vin ?? '—';
      doc.fillColor(theme.highlight).text(`VIN: ${vin}`, rightColX, rightYGrid, { width: halfW - 4 });
      rightYGrid += 14;
      doc.fillColor(theme.text);
      if (vehicle?.year || vehicle?.make || vehicle?.model) {
        const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
        if (ymm) {
          doc.text(ymm, rightColX, rightYGrid, { width: halfW - 4 });
          rightYGrid += 14;
        }
      }
      if (workOrder?.work_order_number) {
        doc.text(`Work Order: ${workOrder.work_order_number}`, rightColX, rightYGrid, { width: halfW - 4 });
        rightYGrid += 14;
      }
      rightYGrid += 8;
    }

    y = Math.max(leftY, rightYGrid) + 16;

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

    // ----- Line items table -----
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

    // ----- Totals panel: taller height so text doesn't overflow -----
    const totalsX = startX + pageWidth - 240;
    const totalsTop = y + 16;
    const totH = 172;
    const lineLead = 20;
    doc.fillColor(theme.panel).strokeColor(theme.panelBorder).rect(totalsX, totalsTop, 240, totH).fillAndStroke();
    doc.fillColor(theme.text).fontSize(10);
    let ty = totalsTop + 14;
    doc.text(`Labor: $${formatMoney(invoice.subtotal_labor)}`, totalsX + 12, ty);
    ty += lineLead;
    doc.text(`Parts: $${formatMoney(invoice.subtotal_parts)}`, totalsX + 12, ty);
    ty += lineLead;
    doc.text(`Fees: $${formatMoney(invoice.subtotal_fees)}`, totalsX + 12, ty);
    ty += lineLead;
    doc.text(`Discount: $${formatMoney(invoice.discount_value)} (${invoice.discount_type || 'NONE'})`, totalsX + 12, ty, { width: 216 });
    ty += lineLead;
    doc.text(`Tax: $${formatMoney(invoice.tax_amount)} (${invoice.tax_rate_percent || 0}%)`, totalsX + 12, ty);
    ty += lineLead + 4;
    doc.fontSize(12).fillColor(theme.total).text(`Total: $${formatMoney(invoice.total_amount)}`, totalsX + 12, ty);
    ty += lineLead + 4;
    doc.fontSize(10).fillColor(theme.paid).text(`Paid: $${formatMoney(invoice.amount_paid)}`, totalsX + 12, ty);
    ty += lineLead + 4;
    doc.fontSize(11).fillColor(theme.balanceDue).text(`Balance Due: $${formatMoney(invoice.balance_due)}`, totalsX + 12, ty);

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
