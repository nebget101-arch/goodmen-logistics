export type ReportKey =
  | 'overview'
  | 'emails'
  | 'total-revenue'
  | 'rate-per-mile'
  | 'revenue-by-dispatcher'
  | 'payment-summary'
  | 'expenses'
  | 'gross-profit'
  | 'gross-profit-per-load'
  | 'profit-loss'
  | 'direct-load-profit'
  | 'fully-loaded-profit';

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  dispatcherId?: string;
  driverId?: string;
  truckId?: string;
  status?: string;
  period?: 'day' | 'week' | 'month';
  groupBy?: 'load' | 'truck' | 'driver';
  limit?: number;
  offset?: number;
  // legacy keys
  location_id?: string;
  date_from?: string;
  date_to?: string;
  [key: string]: string | number | undefined;
}

export interface ReportCard {
  key: string;
  label: string;
  value: number;
  changePct?: number;
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'currency' | 'number' | 'percent' | 'date';
}

export interface ReportResponse<T = Record<string, unknown>> {
  success: boolean;
  data: T[];
  cards?: ReportCard[];
  summary?: Record<string, unknown>;
  meta?: {
    generatedAt: string;
    filters: ReportFilters;
    reportKey?: ReportKey;
  };
}

export interface ReportPageConfig {
  key: ReportKey;
  title: string;
  subtitle: string;
  endpoint: string;
  columns: ReportColumn[];
}

// Legacy compatibility interfaces retained for old reports components.
export interface FinancialSummary {
  totalInvoiced?: number;
  totalPaid?: number;
  totalOutstanding?: number;
  averageInvoice?: number;
}

export interface WorkOrderSummary {
  total?: number;
  completed?: number;
  open?: number;
  avgCompletionHours?: number;
}

export interface KpiSummary {
  totalRevenueMtd?: number;
  openWorkOrders?: number;
  vehiclesOutOfService?: number;
  inventoryValue?: number;
  lowStockItems?: number;
  avgCompletionHours?: number;
}
