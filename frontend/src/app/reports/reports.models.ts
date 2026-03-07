export interface ReportFilters {
  location_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

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
