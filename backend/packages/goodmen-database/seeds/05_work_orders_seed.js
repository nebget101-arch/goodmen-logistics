exports.seed = async function(knex) {
  const existing = await knex('work_orders').select('id').limit(1);
  if (existing.length > 0) return;

  const [location] = await knex('locations').select('id').orderBy('name').limit(1);
  const [vehicle] = await knex('vehicles').select('id', 'unit_number', 'vin').orderBy('unit_number').limit(1);
  const [customer] = await knex('customers').select('id', 'company_name').where({ is_deleted: false }).orderBy('company_name').limit(1);
  const [part] = await knex('parts').select('id', 'sku', 'name', 'default_retail_price', 'taxable').orderBy('sku').limit(1);

  if (!location || !vehicle) return;

  const year = new Date().getFullYear();
  const woNumber1 = `WO-${year}-000001`;
  const woNumber2 = `WO-${year}-000002`;

  const [wo1] = await knex('work_orders').insert({
    work_order_number: woNumber1,
    vehicle_id: vehicle.id,
    customer_id: customer?.id || null,
    location_id: location.id,
    type: 'REPAIR',
    priority: 'HIGH',
    status: 'completed',
    description: 'Brake inspection and pad replacement',
    odometer_miles: 152345,
    discount_type: 'NONE',
    discount_value: 0,
    tax_rate_percent: 8.25,
    completed_at: knex.fn.now(),
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  }).returning('*');

  const [wo2] = await knex('work_orders').insert({
    work_order_number: woNumber2,
    vehicle_id: vehicle.id,
    customer_id: customer?.id || null,
    location_id: location.id,
    type: 'PM',
    priority: 'NORMAL',
    status: 'in_progress',
    description: 'Preventive maintenance - oil and filter',
    odometer_miles: 153100,
    discount_type: 'PERCENT',
    discount_value: 5,
    tax_rate_percent: 7.5,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  }).returning('*');

  if (wo1) {
    await knex('work_order_labor_items').insert([
      {
        work_order_id: wo1.id,
        description: 'Brake inspection',
        hours: 1.5,
        labor_rate: 95,
        taxable: true,
        line_total: 142.5
      },
      {
        work_order_id: wo1.id,
        description: 'Pad replacement',
        hours: 2,
        labor_rate: 95,
        taxable: true,
        line_total: 190
      }
    ]);

    if (part) {
      await knex('work_order_part_items').insert({
        work_order_id: wo1.id,
        part_id: part.id,
        location_id: location.id,
        qty_requested: 1,
        qty_reserved: 1,
        qty_issued: 1,
        unit_price: part.default_retail_price || 280,
        taxable: part.taxable === true,
        status: 'ISSUED',
        line_total: Number(part.default_retail_price || 280)
      });
    }

    await knex('work_order_fees').insert({
      work_order_id: wo1.id,
      fee_type: 'SHOP_SUPPLIES',
      amount: 18.75,
      taxable: true
    });

    await knex('work_order_documents').insert({
      work_order_id: wo1.id,
      file_name: 'inspection_photo.jpg',
      mime_type: 'image/jpeg',
      file_size_bytes: 120342,
      storage_key: 'work-orders/inspection_photo.jpg',
      uploaded_by_user_id: null
    });
  }

  if (wo2) {
    await knex('work_order_labor_items').insert({
      work_order_id: wo2.id,
      description: 'Oil and filter change',
      hours: 1.2,
      labor_rate: 85,
      taxable: true,
      line_total: 102
    });

    if (part) {
      await knex('work_order_part_items').insert({
        work_order_id: wo2.id,
        part_id: part.id,
        location_id: location.id,
        qty_requested: 2,
        qty_reserved: 0,
        qty_issued: 0,
        unit_price: part.default_retail_price || 120,
        taxable: part.taxable === true,
        status: 'BACKORDERED',
        line_total: 0
      });
    }

    await knex('work_order_fees').insert({
      work_order_id: wo2.id,
      fee_type: 'MISC',
      amount: 10,
      taxable: false
    });
  }

  const recomputeTotals = async (workOrderId) => {
    const laborLines = await knex('work_order_labor_items').where({ work_order_id: workOrderId });
    const partLines = await knex('work_order_part_items').where({ work_order_id: workOrderId });
    const feeLines = await knex('work_order_fees').where({ work_order_id: workOrderId });
    const workOrder = await knex('work_orders').where({ id: workOrderId }).first();

    const laborSubtotal = laborLines.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
    const partsSubtotal = partLines.reduce((sum, l) => sum + Number(l.line_total || 0), 0);
    const feesSubtotal = feeLines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const subtotal = laborSubtotal + partsSubtotal + feesSubtotal;

    const discountType = workOrder.discount_type || 'NONE';
    const discountValue = Number(workOrder.discount_value || 0);
    const discountAmount = discountType === 'PERCENT'
      ? subtotal * (discountValue / 100)
      : (discountType === 'AMOUNT' ? discountValue : 0);

    const taxableSubtotal = laborLines.filter(l => l.taxable).reduce((sum, l) => sum + Number(l.line_total || 0), 0)
      + partLines.filter(l => l.taxable).reduce((sum, l) => sum + Number(l.line_total || 0), 0)
      + feeLines.filter(l => l.taxable).reduce((sum, l) => sum + Number(l.amount || 0), 0);

    const taxRate = Number(workOrder.tax_rate_percent || 0);
    const taxableAfterDiscount = subtotal > 0 ? taxableSubtotal - (discountAmount * (taxableSubtotal / subtotal)) : taxableSubtotal;
    const taxAmount = taxableAfterDiscount * (taxRate / 100);
    const totalAmount = subtotal - discountAmount + taxAmount;

    await knex('work_orders').where({ id: workOrderId }).update({
      labor_subtotal: laborSubtotal,
      parts_subtotal: partsSubtotal,
      fees_subtotal: feesSubtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      updated_at: knex.fn.now()
    });
  };

  if (wo1) await recomputeTotals(wo1.id);
  if (wo2) await recomputeTotals(wo2.id);
};
