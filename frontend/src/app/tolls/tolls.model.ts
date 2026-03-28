export interface TollAccount {
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

export interface TollDevice {
  id: string;
  tenant_id: string;
  toll_account_id: string;
  device_number_masked?: string;
  plate_number?: string;
  truck_id?: string;
  trailer_id?: string;
  driver_id?: string;
  effective_start_date?: string;
  effective_end_date?: string;
  status: 'active' | 'inactive';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface TollImportBatch {
  id: string;
  tenant_id: string;
  provider_name: string;
  source_file_name: string;
  import_status: string;
  total_rows: number;
  success_rows: number;
  warning_rows: number;
  failed_rows: number;
  started_at?: string;
  completed_at?: string;
}

export interface TollOverview {
  success: boolean;
  cards: {
    accounts: number;
    devices: number;
    transactions: number;
    openExceptions: number;
  };
  lastBatch: Partial<TollImportBatch> | null;
}

export interface TollUploadResult {
  batchId: string;
  fileName: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

export interface TollCommitResult {
  batchId: string;
  totalRows: number;
  successCount: number;
  duplicateCount: number;
  errorCount: number;
  exceptionsCreated: number;
}

export interface TollMappingProfile {
  id: string;
  tenant_id: string;
  profile_name: string;
  provider_name?: string;
  column_map: Record<string, string>;
  is_default: boolean;
  created_at: string;
}

/** Normalized field keys used in toll column mapping */
export const TOLL_NORMALIZED_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: 'transaction_date', label: 'Transaction Date', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'plaza_name', label: 'Plaza / Agency', required: false },
  { key: 'entry_location', label: 'Entry Location', required: false },
  { key: 'exit_location', label: 'Exit Location', required: false },
  { key: 'device_number_masked', label: 'Transponder #', required: false },
  { key: 'plate_number_raw', label: 'Plate Number', required: false },
  { key: 'unit_number_raw', label: 'Truck Unit', required: false },
  { key: 'driver_name_raw', label: 'Driver Name', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'state', label: 'State', required: false },
  { key: 'posted_date', label: 'Posted Date', required: false },
  { key: 'external_transaction_id', label: 'External Transaction ID', required: false },
];
