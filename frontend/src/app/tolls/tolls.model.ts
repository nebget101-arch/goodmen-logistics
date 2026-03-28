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

export interface TollTransaction {
  id: string;
  tenant_id: string;
  provider_name: string;
  external_transaction_id?: string;
  transaction_date: string;
  posted_date?: string;
  truck_id?: string;
  driver_id?: string;
  load_id?: string;
  unit_number_raw?: string;
  driver_name_raw?: string;
  device_number_masked?: string;
  plate_number_raw?: string;
  plaza_name?: string;
  entry_location?: string;
  exit_location?: string;
  city?: string;
  state?: string;
  amount: number;
  currency: string;
  matched_status: string;
  validation_status: string;
  settlement_link_status: string;
  is_manual: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined
  truck_display?: string;
  driver_display?: string;
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
