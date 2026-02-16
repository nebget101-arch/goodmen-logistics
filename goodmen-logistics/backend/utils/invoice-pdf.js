const PDFDocument = require('pdfkit');

function buildInvoicePdf({ invoice, customer, location, lineItems, payments }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Invoice', { align: 'right' });
    doc.moveDown(0.5);

    doc.fontSize(10).text(`Invoice #: ${invoice.invoice_number}`);
    doc.text(`Status: ${invoice.status}`);
    doc.text(`Issued: ${invoice.issued_date || ''}`);
    doc.text(`Due: ${invoice.due_date || ''}`);
    doc.text(`Terms: ${invoice.payment_terms || ''}`);

    doc.moveDown();
    doc.fontSize(12).text('Bill To', { underline: true });
    doc.fontSize(10).text(customer.company_name || '');
    doc.text(customer.billing_address_line1 || '');
    if (customer.billing_address_line2) doc.text(customer.billing_address_line2);
    doc.text([customer.billing_city, customer.billing_state, customer.billing_zip].filter(Boolean).join(', '));
    doc.text(customer.billing_country || '');

    doc.moveDown();
    doc.fontSize(12).text('Location', { underline: true });
    doc.fontSize(10).text(location?.name || '');
    if (location?.address) doc.text(location.address);

    doc.moveDown();
    doc.fontSize(12).text('Line Items', { underline: true });
    doc.moveDown(0.5);

    const tableHeader = ['Type', 'Description', 'Qty', 'Unit', 'Total'];
    doc.fontSize(10).text(tableHeader.join(' | '));
    doc.moveDown(0.2);

    lineItems.forEach(item => {
      doc.text([
        item.line_type,
        item.description,
        Number(item.quantity || 0).toFixed(2),
        Number(item.unit_price || 0).toFixed(2),
        Number(item.line_total || 0).toFixed(2)
      ].join(' | '));
    });

    doc.moveDown();
    doc.fontSize(12).text('Totals', { underline: true });
    doc.fontSize(10).text(`Subtotal Labor: $${Number(invoice.subtotal_labor || 0).toFixed(2)}`);
    doc.text(`Subtotal Parts: $${Number(invoice.subtotal_parts || 0).toFixed(2)}`);
    doc.text(`Subtotal Fees: $${Number(invoice.subtotal_fees || 0).toFixed(2)}`);
    doc.text(`Discount: $${Number(invoice.discount_value || 0).toFixed(2)} (${invoice.discount_type})`);
    doc.text(`Tax: $${Number(invoice.tax_amount || 0).toFixed(2)} (${invoice.tax_rate_percent}%)`);
    doc.text(`Total: $${Number(invoice.total_amount || 0).toFixed(2)}`);
    doc.text(`Amount Paid: $${Number(invoice.amount_paid || 0).toFixed(2)}`);
    doc.text(`Balance Due: $${Number(invoice.balance_due || 0).toFixed(2)}`);

    if (payments?.length) {
      doc.moveDown();
      doc.fontSize(12).text('Payments', { underline: true });
      doc.fontSize(10);
      payments.forEach(p => {
        doc.text(`${p.payment_date} - ${p.method} - $${Number(p.amount || 0).toFixed(2)} ${p.reference_number || ''}`);
      });
    }

    if (invoice.notes) {
      doc.moveDown();
      doc.fontSize(12).text('Notes', { underline: true });
      doc.fontSize(10).text(invoice.notes);
    }

    doc.end();
  });
}

module.exports = { buildInvoicePdf };
