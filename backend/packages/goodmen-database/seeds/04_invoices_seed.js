exports.seed = async function(knex) {
  const existing = await knex('invoices').select('id').limit(1);

  const [customer] = await knex('customers').select('id', 'company_name', 'payment_terms').where({ is_deleted: false }).orderBy('company_name').limit(1);
  const [location] = await knex('locations').select('id').orderBy('name').limit(1);
  if (!customer || !location) return;

  if (existing.length === 0) {
    const invoiceNumber = `INV-${new Date().getFullYear()}-000001`;

    const [invoice] = await knex('invoices').insert({
      invoice_number: invoiceNumber,
      customer_id: customer.id,
      location_id: location.id,
      status: 'SENT',
      issued_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      payment_terms: customer.payment_terms || 'NET_15',
      discount_type: 'NONE',
      discount_value: 0,
      tax_rate_percent: 8.25,
      notes: 'Seed invoice for demo'
    }).returning('*');

    await knex('invoice_line_items').insert([
      {
        invoice_id: invoice.id,
        line_type: 'LABOR',
        description: 'Brake inspection and adjustment',
        quantity: 3,
        unit_price: 95,
        taxable: true,
        line_total: 285
      },
      {
        invoice_id: invoice.id,
        line_type: 'PART',
        description: 'Brake pads set',
        quantity: 1,
        unit_price: 280,
        taxable: true,
        line_total: 280
      }
    ]);

    await knex('invoice_payments').insert({
      invoice_id: invoice.id,
      payment_date: new Date().toISOString().slice(0, 10),
      amount: 200,
      method: 'CARD',
      reference_number: 'AUTH-1001'
    });

    // Recompute totals for the manual invoice
    const lineItems = await knex('invoice_line_items').where({ invoice_id: invoice.id });
    const subtotalLabor = lineItems.filter(l => l.line_type === 'LABOR').reduce((s, l) => s + Number(l.line_total), 0);
    const subtotalParts = lineItems.filter(l => l.line_type === 'PART').reduce((s, l) => s + Number(l.line_total), 0);
    const subtotalFees = 0;
    const subtotal = subtotalLabor + subtotalParts + subtotalFees;
    const taxAmount = subtotal * (8.25 / 100);
    const totalAmount = subtotal + taxAmount;
    const amountPaid = 200;
    const balanceDue = totalAmount - amountPaid;

    await knex('invoices').where({ id: invoice.id }).update({
      subtotal_labor: subtotalLabor,
      subtotal_parts: subtotalParts,
      subtotal_fees: subtotalFees,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      status: 'PARTIAL'
    });
  }

  // If a work order exists, seed a second invoice linked to it
  const workOrder = await knex('work_orders')
    .leftJoin('invoices', 'work_orders.id', 'invoices.work_order_id')
    .whereNull('invoices.id')
    .select('work_orders.*')
    .orderBy('work_orders.created_at', 'desc')
    .first();
  if (!workOrder) return;

  const invoiceNumber2 = `INV-${new Date().getFullYear()}-000002`;
  const [invoice2] = await knex('invoices').insert({
    invoice_number: invoiceNumber2,
    work_order_id: workOrder.id,
    customer_id: workOrder.customer_id || customer.id,
    location_id: workOrder.location_id || location.id,
    status: 'SENT',
    issued_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    payment_terms: customer.payment_terms || 'NET_30',
    discount_type: workOrder.discount_type || 'NONE',
    discount_value: workOrder.discount_value || 0,
    tax_rate_percent: workOrder.tax_rate_percent || 0,
    notes: 'Seed invoice from work order'
  }).returning('*');

  const laborLines = await knex('work_order_labor_items').where({ work_order_id: workOrder.id });
  const partLines = await knex('work_order_part_items').where({ work_order_id: workOrder.id });
  const feeLines = await knex('work_order_fees').where({ work_order_id: workOrder.id });
  const partCatalog = partLines.length ? await knex('parts').whereIn('id', partLines.map(p => p.part_id)) : [];
  const partNameById = partCatalog.reduce((acc, p) => {
    acc[p.id] = p.name || p.sku || p.id;
    return acc;
  }, {});

  const invoiceLines = [];
  for (const labor of laborLines) {
    invoiceLines.push({
      invoice_id: invoice2.id,
      line_type: 'LABOR',
      source_ref_type: 'work_order_labor',
      source_ref_id: labor.id,
      description: labor.description || 'Labor',
      quantity: labor.hours || 0,
      unit_price: labor.labor_rate || 0,
      taxable: labor.taxable === true,
      line_total: labor.line_total || 0
    });
  }

  for (const part of partLines) {
    const qty = Number(part.qty_issued || 0);
    if (qty <= 0) continue;
    invoiceLines.push({
      invoice_id: invoice2.id,
      line_type: 'PART',
      source_ref_type: 'work_order_part',
      source_ref_id: part.id,
      description: partNameById[part.part_id] || `Part ${part.part_id}`,
      quantity: qty,
      unit_price: part.unit_price || 0,
      taxable: part.taxable === true,
      line_total: qty * Number(part.unit_price || 0)
    });
  }

  for (const fee of feeLines) {
    invoiceLines.push({
      invoice_id: invoice2.id,
      line_type: 'FEE',
      source_ref_type: 'work_order_fee',
      source_ref_id: fee.id,
      description: fee.fee_type,
      quantity: 1,
      unit_price: fee.amount || 0,
      taxable: fee.taxable === true,
      line_total: fee.amount || 0
    });
  }

  if (invoiceLines.length) {
    await knex('invoice_line_items').insert(invoiceLines);
  }

  const secondLines = await knex('invoice_line_items').where({ invoice_id: invoice2.id });
  const subtotalLabor2 = secondLines.filter(l => l.line_type === 'LABOR').reduce((s, l) => s + Number(l.line_total), 0);
  const subtotalParts2 = secondLines.filter(l => l.line_type === 'PART').reduce((s, l) => s + Number(l.line_total), 0);
  const subtotalFees2 = secondLines.filter(l => l.line_type === 'FEE').reduce((s, l) => s + Number(l.line_total), 0);
  const subtotal2 = subtotalLabor2 + subtotalParts2 + subtotalFees2;
  const taxAmount2 = subtotal2 * (Number(invoice2.tax_rate_percent || 0) / 100);
  const totalAmount2 = subtotal2 + taxAmount2;

  await knex('invoices').where({ id: invoice2.id }).update({
    subtotal_labor: subtotalLabor2,
    subtotal_parts: subtotalParts2,
    subtotal_fees: subtotalFees2,
    tax_amount: taxAmount2,
    total_amount: totalAmount2,
    amount_paid: 0,
    balance_due: totalAmount2,
    status: 'SENT'
  });
};
