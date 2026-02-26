async function generateInvoiceNumber(trx) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await trx('invoices')
    .where('invoice_number', 'like', `${prefix}%`)
    .orderBy('invoice_number', 'desc')
    .first();

  let seq = 0;
  if (last?.invoice_number) {
    const parts = last.invoice_number.split('-');
    const lastSeq = parts[2] ? parseInt(parts[2], 10) : 0;
    seq = Number.isNaN(lastSeq) ? 0 : lastSeq;
  }

  const nextSeq = seq + 1;
  return `${prefix}${String(nextSeq).padStart(6, '0')}`;
}

module.exports = { generateInvoiceNumber };
