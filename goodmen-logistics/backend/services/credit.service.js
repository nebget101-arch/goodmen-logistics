const db = require('../config/knex');

function normalizeDecimal(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Get customer credit balance
 */
async function getCustomerCreditBalance(customerId) {
  try {
    const balance = await db('customer_credit_balance')
      .where({ customer_id: customerId })
      .first();
    
    if (!balance) {
      // Initialize balance from customer credit_limit
      const customer = await db('customers').where({ id: customerId }).first();
      if (!customer) throw new Error('Customer not found');
      
      const newBalance = await db('customer_credit_balance').insert({
        customer_id: customerId,
        credit_limit: normalizeDecimal(customer.credit_limit),
        credit_used: 0,
        available_credit: normalizeDecimal(customer.credit_limit)
      }).returning('*');
      
      return newBalance[0];
    }
    
    return balance;
  } catch (error) {
    throw new Error(`Failed to get credit balance: ${error.message}`);
  }
}

/**
 * Apply invoice to customer credit
 */
async function applyInvoiceToCredit(customerId, invoiceId, invoiceAmount, userId) {
  return db.transaction(async trx => {
    const balance = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .first();
    
    if (!balance) throw new Error('Customer credit balance not found');
    
    const previousBalance = normalizeDecimal(balance.available_credit);
    const newUsed = normalizeDecimal(balance.credit_used) + normalizeDecimal(invoiceAmount);
    const newAvailable = normalizeDecimal(balance.credit_limit) - newUsed;
    
    if (newAvailable < 0) {
      throw new Error(`Invoice exceeds available credit. Available: $${previousBalance.toFixed(2)}, Invoice: $${invoiceAmount.toFixed(2)}`);
    }
    
    // Update balance
    const [updated] = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .update({
        credit_used: newUsed,
        available_credit: newAvailable,
        updated_at: trx.fn.now()
      })
      .returning('*');
    
    // Log transaction
    await trx('customer_credit_transactions').insert({
      customer_id: customerId,
      transaction_type: 'INVOICE_APPLIED',
      reference_id: invoiceId,
      reference_type: 'invoice',
      amount: -normalizeDecimal(invoiceAmount),
      description: `Invoice applied to credit`,
      previous_balance: previousBalance,
      new_balance: newAvailable,
      created_by_user_id: userId || null
    });
    
    return updated;
  });
}

/**
 * Apply payment to customer credit
 */
async function applyPaymentToCredit(customerId, invoiceId, paymentAmount, paymentMethod, userId) {
  return db.transaction(async trx => {
    const balance = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .first();
    
    if (!balance) throw new Error('Customer credit balance not found');
    
    const previousBalance = normalizeDecimal(balance.available_credit);
    const newUsed = Math.max(0, normalizeDecimal(balance.credit_used) - normalizeDecimal(paymentAmount));
    const newAvailable = normalizeDecimal(balance.credit_limit) - newUsed;
    
    // Update balance
    const [updated] = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .update({
        credit_used: newUsed,
        available_credit: newAvailable,
        updated_at: trx.fn.now()
      })
      .returning('*');
    
    // Log transaction
    await trx('customer_credit_transactions').insert({
      customer_id: customerId,
      transaction_type: 'PAYMENT',
      reference_id: invoiceId,
      reference_type: 'invoice',
      amount: normalizeDecimal(paymentAmount),
      description: `Payment received (${paymentMethod})`,
      previous_balance: previousBalance,
      new_balance: newAvailable,
      created_by_user_id: userId || null
    });
    
    return updated;
  });
}

/**
 * Update customer credit limit
 */
async function updateCreditLimit(customerId, newLimit, userId) {
  return db.transaction(async trx => {
    const balance = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .first();
    
    if (!balance) throw new Error('Customer credit balance not found');
    
    const previousBalance = normalizeDecimal(balance.available_credit);
    const newAvailable = normalizeDecimal(newLimit) - normalizeDecimal(balance.credit_used);
    
    // Update balance
    const [updated] = await trx('customer_credit_balance')
      .where({ customer_id: customerId })
      .update({
        credit_limit: normalizeDecimal(newLimit),
        available_credit: newAvailable,
        updated_at: trx.fn.now()
      })
      .returning('*');
    
    // Update customers table as well
    await trx('customers').where({ id: customerId }).update({
      credit_limit: normalizeDecimal(newLimit)
    });
    
    // Log transaction
    await trx('customer_credit_transactions').insert({
      customer_id: customerId,
      transaction_type: 'LIMIT_CHANGE',
      amount: normalizeDecimal(newLimit),
      description: `Credit limit updated to $${newLimit.toFixed(2)}`,
      previous_balance: previousBalance,
      new_balance: newAvailable,
      created_by_user_id: userId || null
    });
    
    return updated;
  });
}

/**
 * Get credit transaction history
 */
async function getCreditTransactionHistory(customerId, filters = {}) {
  const { page = 1, pageSize = 20, type } = filters;
  
  const limit = Math.max(parseInt(pageSize, 10) || 20, 1);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;
  
  let query = db('customer_credit_transactions')
    .where({ customer_id: customerId });
  
  if (type) {
    query = query.andWhere({ transaction_type: type });
  }
  
  const [{ count }] = await query.clone().count();
  const rows = await query
    .clone()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
  
  return {
    rows,
    total: parseInt(count, 10) || 0,
    page: parseInt(page, 10) || 1,
    pageSize: limit
  };
}

/**
 * Check if customer can use credit for invoice
 */
async function canUseCredit(customerId, invoiceAmount) {
  const balance = await getCustomerCreditBalance(customerId);
  const availableCredit = normalizeDecimal(balance.available_credit);
  const amount = normalizeDecimal(invoiceAmount);
  
  return {
    canUse: availableCredit >= amount,
    availableCredit,
    requiredAmount: amount,
    shortfall: Math.max(0, amount - availableCredit)
  };
}

module.exports = {
  getCustomerCreditBalance,
  applyInvoiceToCredit,
  applyPaymentToCredit,
  updateCreditLimit,
  getCreditTransactionHistory,
  canUseCredit
};
