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

export interface TollException {
  id: string;
  tenant_id: string;
  toll_transaction_id: string;
  exception_type: string;
  exception_message?: string;
  resolution_status: 'open' | 'resolved' | 'ignored';
  resolved_by?: string;
  resolved_at?: string;
  resolution_notes?: string;
  created_at: string;
  // Joined from toll_transactions
  transaction_date?: string;
  provider_name?: string;
  plaza_name?: string;
  amount?: number;
  unit_number_raw?: string;
  driver_name_raw?: string;
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
