export interface Customer {
  id: string;
  company_name: string;
  customer_type: 'FLEET' | 'WALK_IN' | 'INTERNAL' | 'WARRANTY';
  status: 'ACTIVE' | 'INACTIVE';
  tax_id?: string | null;
  primary_contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  secondary_phone?: string | null;
  website?: string | null;
  billing_address_line1?: string | null;
  billing_address_line2?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  billing_country?: string | null;
  payment_terms?: 'DUE_ON_RECEIPT' | 'NET_15' | 'NET_30' | 'CUSTOM';
  payment_terms_custom_days?: number | null;
  credit_limit?: number | null;
  tax_exempt?: boolean | null;
  billing_notes?: string | null;
  default_location_id?: string | null;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  note_type: 'GENERAL' | 'BILLING' | 'SERVICE_ISSUE';
  note: string;
  created_at: string;
  created_by_user_id?: string | null;
}

export interface CustomerPricingRule {
  id?: string;
  customer_id?: string;
  default_labor_rate?: number | null;
  parts_discount_percent?: number | null;
  labor_discount_percent?: number | null;
  shop_supplies_percent?: number | null;
  tax_override_percent?: number | null;
  contract_pricing_enabled?: boolean;
}

export interface WorkOrderSummary {
  id: string;
  vehicle_id: string;
  date_performed: string;
  status: string;
  cost: number;
  priority?: string | null;
}
