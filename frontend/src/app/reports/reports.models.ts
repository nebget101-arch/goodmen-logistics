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

export type ReportAnomalySeverity = 'info' | 'warning' | 'critical';

export interface ReportAnomaly {
  metric: string;
  value: number;
  deltaPct: number;
  severity: ReportAnomalySeverity;
  context?: string;
}

export interface ReportAnomaliesResponse {
  anomalies: ReportAnomaly[];
}

export interface ReportAnomaliesRequest {
  data: Record<string, unknown>[];
  filters: ReportFilters;
  priorPeriod?: Record<string, unknown>;
}

export interface ReportNarrativeRequest {
  cards?: ReportCard[];
  data?: Record<string, unknown>[];
  filters?: ReportFilters;
  priorPeriod?: Record<string, unknown>;
}

export interface ReportNarrative {
  narrative: string;
  generatedAt: string;
}

export interface ReportChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ReportChatRequest {
  reportKey: string;
  filters: ReportFilters;
  data: Array<Record<string, unknown>>;
  history: ReportChatMessage[];
  message: string;
  summary?: Record<string, unknown>;
}

export interface ReportChatUsage {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  _truncated?: boolean;
}

export interface ReportChatResponse {
  reply: string;
  generatedAt?: string;
  usage?: ReportChatUsage;
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
