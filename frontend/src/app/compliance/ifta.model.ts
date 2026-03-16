export type IftaQuarterStatus = 'draft' | 'under_review' | 'finalized' | 'exported';

export interface IftaQuarter {
  id: string;
  quarter: number;
  tax_year: number;
  filing_entity_name: string | null;
  status: IftaQuarterStatus;
  selected_truck_ids: string[];
  ai_readiness_score?: number | null;
  ai_narrative?: string | null;
  total_taxable_miles: string | number;
  total_fleet_miles: string | number;
  total_gallons: string | number;
  fleet_mpg: string | number;
  total_due_credit: string | number;
  open_warnings?: number;
}

export interface IftaMilesEntry {
  id: string;
  truck_id?: string | null;
  unit: string;
  jurisdiction: string;
  taxable_miles: string | number;
  non_taxable_miles: string | number;
  total_miles: string | number;
  source: string;
  notes?: string | null;
}

export interface IftaFuelEntry {
  id: string;
  purchase_date: string;
  truck_id?: string | null;
  unit: string;
  jurisdiction: string;
  vendor?: string | null;
  receipt_invoice_number?: string | null;
  gallons: string | number;
  amount: string | number;
  fuel_type: string;
  tax_paid: boolean;
  attachment_link?: string | null;
  source: string;
  duplicate_suspected?: boolean;
  notes?: string | null;
}

export interface IftaFinding {
  id: string;
  finding_type: string;
  severity: 'info' | 'warning' | 'blocker';
  title: string;
  details?: string | null;
  resolved: boolean;
  resolved_notes?: string | null;
}

export interface IftaJurisdictionSummary {
  jurisdiction: string;
  total_miles: string | number;
  taxable_miles: string | number;
  tax_paid_gallons: string | number;
  net_taxable_gallons: string | number;
  tax_rate: string | number;
  tax_due_credit: string | number;
}

export interface IftaPaged<T> {
  rows: T[];
  total: number;
  totals?: Array<Record<string, unknown>>;
}
