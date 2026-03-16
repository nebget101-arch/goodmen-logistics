export type LeaseAgreementStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'completed'
  | 'overdue'
  | 'defaulted'
  | 'terminated';

export interface LeaseAgreement {
  id: string;
  agreement_number: string;
  driver_id: string;
  truck_id: string;
  driver_name?: string;
  truck_label?: string;
  agreement_start_date: string;
  purchase_price: number;
  down_payment: number;
  financed_principal: number;
  total_payable: number;
  payment_frequency: 'weekly' | 'biweekly' | 'monthly';
  payment_amount: number;
  remaining_balance: number;
  next_due_date?: string | null;
  risk_level?: 'low' | 'medium' | 'high';
  risk_score?: number;
  status: LeaseAgreementStatus;
}

export interface LeaseScheduleRow {
  id: string;
  agreement_id: string;
  installment_number: number;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  remaining_due: number;
  status: 'pending' | 'partial' | 'paid' | 'overdue' | 'skipped' | 'waived';
}

export interface LeasePaymentTransaction {
  id: string;
  payment_schedule_id?: string;
  settlement_id?: string;
  amount_paid: number;
  payment_method: string;
  payment_date: string;
  notes?: string;
}

export interface FinancingSummary {
  total_financed_amount: number;
  current_outstanding_principal: number;
  payments_collected_to_date: number;
  overdue_amount: number;
  active_agreements: number;
  overdue_agreements: number;
  defaulted_agreements: number;
  completed_agreements: number;
  portfolio_size: number;
}

export interface RiskRow {
  agreement_id: string;
  agreement_number: string;
  driver_name: string;
  risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  reason_codes?: string[] | string;
  recommended_action?: string;
  remaining_balance: number;
}
