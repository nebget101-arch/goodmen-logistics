const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

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

function buildInvoicePdf({ invoice, customer, location, lineItems, payments }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    const startY = doc.page.margins.top;

    // Header
    const logoPath = path.join(__dirname, '..', 'frontend', 'src', 'assets', 'goodmen-logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, startX, startY, { width: 120 });
    }

    doc.fontSize(20).fillColor('#1a237e').text('INVOICE', startX + 140, startY, { align: 'right', width: pageWidth - 140 });
    doc.fontSize(10).fillColor('#333');
    doc.text(`Invoice #: ${invoice.invoice_number}`, startX + 140, startY + 26, { align: 'right', width: pageWidth - 140 });
    doc.text(`Status: ${invoice.status}`, startX + 140, startY + 40, { align: 'right', width: pageWidth - 140 });

    doc.moveTo(startX, startY + 70).lineTo(startX + pageWidth, startY + 70).strokeColor('#e0e0e0').stroke();

    // Bill To + Location
    const blockTop = startY + 85;
    doc.fontSize(11).fillColor('#1a237e').text('Bill To', startX, blockTop);
    doc.fontSize(10).fillColor('#333');
    doc.text(customer?.company_name || '', startX, blockTop + 14);
    doc.text(customer?.billing_address_line1 || '', startX, blockTop + 28);
    if (customer?.billing_address_line2) doc.text(customer.billing_address_line2, startX, blockTop + 42);
    doc.text([customer?.billing_city, customer?.billing_state, customer?.billing_zip].filter(Boolean).join(', '), startX, blockTop + 56);
    doc.text(customer?.billing_country || '', startX, blockTop + 70);

    const rightBlockX = startX + pageWidth / 2 + 20;
    doc.fontSize(11).fillColor('#1a237e').text('Location', rightBlockX, blockTop);
    doc.fontSize(10).fillColor('#333');
    doc.text(location?.name || '', rightBlockX, blockTop + 14);
    doc.text(location?.address || '', rightBlockX, blockTop + 28, { width: pageWidth / 2 - 20 });

    doc.fontSize(11).fillColor('#1a237e').text('Invoice Details', rightBlockX, blockTop + 60);
    doc.fontSize(10).fillColor('#333');
    doc.text(`Issued: ${formatDate(invoice.issued_date)}`, rightBlockX, blockTop + 74);
    doc.text(`Due: ${formatDate(invoice.due_date)}`, rightBlockX, blockTop + 88);
    doc.text(`Terms: ${invoice.payment_terms || ''}`, rightBlockX, blockTop + 102);

    // Line items table
    const tableTop = blockTop + 130;
    const rowHeight = 20;
    const colX = [startX, startX + 70, startX + 310, startX + 380, startX + 460];
    const colWidths = [70, 240, 70, 70, 80];

    doc.rect(startX, tableTop, pageWidth, rowHeight).fill('#f5f5f5');
    doc.fillColor('#333').fontSize(10);
    doc.text('Type', colX[0] + 4, tableTop + 5, { width: colWidths[0] });
    doc.text('Description', colX[1] + 4, tableTop + 5, { width: colWidths[1] });
    doc.text('Qty', colX[2], tableTop + 5, { width: colWidths[2], align: 'right' });
    doc.text('Unit', colX[3], tableTop + 5, { width: colWidths[3], align: 'right' });
    doc.text('Total', colX[4], tableTop + 5, { width: colWidths[4], align: 'right' });

    doc.strokeColor('#e0e0e0').lineWidth(1).rect(startX, tableTop, pageWidth, rowHeight).stroke();

    let y = tableTop + rowHeight;
    lineItems.forEach(item => {
      doc.fillColor('#333').fontSize(10);
      doc.text(item.line_type || '', colX[0] + 4, y + 5, { width: colWidths[0] });
      doc.text(item.description || '', colX[1] + 4, y + 5, { width: colWidths[1] });
      doc.text(formatMoney(item.quantity || 0), colX[2], y + 5, { width: colWidths[2], align: 'right' });
      doc.text(formatMoney(item.unit_price || 0), colX[3], y + 5, { width: colWidths[3], align: 'right' });
      doc.text(formatMoney(item.line_total || 0), colX[4], y + 5, { width: colWidths[4], align: 'right' });
      doc.strokeColor('#f0f0f0').rect(startX, y, pageWidth, rowHeight).stroke();
      y += rowHeight;
    });

    // Totals box
    const totalsTop = y + 10;
    const totalsX = startX + pageWidth - 220;
    const totalsWidth = 220;

    doc.rect(totalsX, totalsTop, totalsWidth, 130).fill('#fafafa');
    doc.fillColor('#333').fontSize(10);
    doc.text(`Labor: $${formatMoney(invoice.subtotal_labor)}`, totalsX + 10, totalsTop + 10);
    doc.text(`Parts: $${formatMoney(invoice.subtotal_parts)}`, totalsX + 10, totalsTop + 26);
    doc.text(`Fees: $${formatMoney(invoice.subtotal_fees)}`, totalsX + 10, totalsTop + 42);
    doc.text(`Discount: $${formatMoney(invoice.discount_value)} (${invoice.discount_type || 'NONE'})`, totalsX + 10, totalsTop + 58, { width: totalsWidth - 20 });
    doc.text(`Tax: $${formatMoney(invoice.tax_amount)} (${invoice.tax_rate_percent || 0}%)`, totalsX + 10, totalsTop + 74);
    doc.fontSize(11).fillColor('#1a237e').text(`Total: $${formatMoney(invoice.total_amount)}`, totalsX + 10, totalsTop + 94);
    doc.fontSize(10).fillColor('#333').text(`Paid: $${formatMoney(invoice.amount_paid)}`, totalsX + 10, totalsTop + 110);
    doc.fontSize(11).fillColor('#1a237e').text(`Balance: $${formatMoney(invoice.balance_due)}`, totalsX + 10, totalsTop + 126);

    // Payments
    if (payments?.length) {
      const payTop = totalsTop + 150;
      doc.fontSize(11).fillColor('#1a237e').text('Payments', startX, payTop);
      doc.fontSize(10).fillColor('#333');
      payments.forEach((p, idx) => {
        doc.text(`${formatDate(p.payment_date)} - ${p.method} - $${formatMoney(p.amount)} ${p.reference_number || ''}`, startX, payTop + 14 + idx * 14);
      });
    }

    if (invoice.notes) {
      const notesTop = totalsTop + 150 + (payments?.length ? payments.length * 14 + 20 : 20);
      doc.fontSize(11).fillColor('#1a237e').text('Notes', startX, notesTop);
      doc.fontSize(10).fillColor('#333').text(invoice.notes, startX, notesTop + 14, { width: pageWidth });
    }

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
