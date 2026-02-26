export interface Invoice {
  id: string;
  invoice_number: string;
  work_order_id?: string | null;
  customer_id: string;
  location_id: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';
  issued_date?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  subtotal_labor?: number;
  subtotal_parts?: number;
  subtotal_fees?: number;
  discount_type?: 'NONE' | 'PERCENT' | 'AMOUNT';
  discount_value?: number;
  tax_rate_percent?: number;
  tax_amount?: number;
  total_amount?: number;
  amount_paid?: number;
  balance_due?: number;
}

export interface InvoiceLineItem {
  id?: string;
  invoice_id?: string;
  line_type: 'LABOR' | 'PART' | 'FEE' | 'ADJUSTMENT';
  description: string;
  quantity: number;
  unit_price: number;
  taxable?: boolean;
  line_total?: number;
}

export interface InvoicePayment {
  id?: string;
  invoice_id?: string;
  payment_date: string;
  amount: number;
  method: 'CASH' | 'CHECK' | 'CARD' | 'ACH' | 'WIRE' | 'ZELLE' | 'OTHER';
  reference_number?: string;
  memo?: string;
}

export interface InvoiceDocument {
  id?: string;
  invoice_id?: string;
  doc_type: 'INVOICE_PDF' | 'SUPPORTING';
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_key: string;
}
