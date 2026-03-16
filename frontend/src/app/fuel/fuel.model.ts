/**
 * Fuel module – TypeScript interfaces (mirrors backend schema).
 */

export type MatchedStatus = 'unmatched' | 'partial' | 'matched' | 'manual';
export type ValidationStatus = 'valid' | 'warning' | 'duplicate' | 'error';
export type SettlementLinkStatus = 'none' | 'pending' | 'linked' | 'excluded';
export type ImportStatus = 'pending' | 'validating' | 'validated' | 'importing' | 'completed' | 'failed' | 'rolled_back';

export interface FuelCardAccount {
  id: string;
  tenant_id: string;
  provider_name: string;
  display_name: string;
  account_number_masked?: string;
  import_method: string;
  status: 'active' | 'inactive';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface FuelMappingProfile {
  id: string;
  tenant_id: string;
  profile_name: string;
  provider_name?: string;
  column_map: Record<string, string | null>;
  is_default: boolean;
  created_at: string;
}

export interface FuelImportBatch {
  id: string;
  tenant_id: string;
  provider_name: string;
  source_file_name: string;
  import_status: ImportStatus;
  total_rows: number;
  success_rows: number;
  warning_rows: number;
  failed_rows: number;
  imported_by_user_id?: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
}

export interface FuelImportBatchRow {
  id: string;
  batch_id: string;
  row_number: number;
  raw_payload?: Record<string, string>;
  normalized_payload?: Record<string, string>;
  validation_errors?: string[];
  warnings?: string[];
  match_result?: Record<string, unknown>;
  resolution_status: string;
}

export interface FuelTransaction {
  id: string;
  tenant_id: string;
  provider_name: string;
  transaction_date: string;
  posted_date?: string;
  truck_id?: string;
  driver_id?: string;
  unit_number_raw?: string;
  driver_name_raw?: string;
  card_number_masked?: string;
  vendor_name?: string;
  city?: string;
  state?: string;
  gallons: number;
  amount: number;
  price_per_gallon?: number;
  currency: string;
  odometer?: number;
  product_type?: string;
  notes?: string;
  matched_status: MatchedStatus;
  validation_status: ValidationStatus;
  settlement_link_status: SettlementLinkStatus;
  is_manual: boolean;
  source_batch_id?: string;
  source_row_number?: number;
  created_at: string;
  updated_at: string;
  // Joined display fields
  truck_display?: string;
  driver_display?: string;
}

export interface FuelException {
  id: string;
  fuel_transaction_id: string;
  tenant_id: string;
  exception_type: string;
  exception_message?: string;
  resolution_status: 'open' | 'resolved' | 'ignored' | 'reprocessed';
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
  // Joined from fuel_transactions
  transaction_date?: string;
  provider_name?: string;
  vendor_name?: string;
  unit_number_raw?: string;
  driver_name_raw?: string;
  card_number_masked?: string;
  gallons?: number;
  amount?: number;
  city?: string;
  state?: string;
}

export interface FuelOverview {
  week: { totalAmount: number; totalGallons: number; count: number };
  month: { totalAmount: number; totalGallons: number; avgPpg: number; count: number };
  topVendors: { name: string; total: number; count: number }[];
  byState: { state: string; gallons: number; amount: number }[];
  unmatchedTransactions: number;
  openExceptions: number;
  lastBatch: Partial<FuelImportBatch> | null;
}

export interface ProviderTemplate {
  key: string;
  label: string;
}

export interface ImportPreviewResult {
  headers: string[];
  autoMapping: Record<string, string | null>;
  preview: { rowNumber: number; raw: Record<string, string>; normalized: Record<string, string> }[];
  totalRows: number;
}

export interface StageResult {
  batchId: string;
  totalRows: number;
  successCount: number;
  warningCount: number;
  failedCount: number;
}

/** Normalized field keys used in column mapping */
export const FUEL_NORMALIZED_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'transaction_date', label: 'Transaction Date', required: true },
  { key: 'gallons', label: 'Gallons', required: true },
  { key: 'amount', label: 'Total Amount', required: true },
  { key: 'unit_number_raw', label: 'Truck Unit', required: false },
  { key: 'driver_name_raw', label: 'Driver Name', required: false },
  { key: 'card_number_masked', label: 'Card Number', required: false },
  { key: 'vendor_name', label: 'Vendor / Station', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'price_per_gallon', label: 'Price Per Gallon', required: false },
  { key: 'odometer', label: 'Odometer', required: false },
  { key: 'product_type', label: 'Product Type', required: false },
  { key: 'posted_date', label: 'Posted Date', required: false },
  { key: 'provider_name', label: 'Provider Name', required: false },
  { key: 'external_transaction_id', label: 'External Transaction ID', required: false },
];
