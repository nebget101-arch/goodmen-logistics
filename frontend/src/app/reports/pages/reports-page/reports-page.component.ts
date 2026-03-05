import { Component, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../../../services/api.service';
import { ReportsService } from '../../services/reports.service';
import { ReportFilters, FinancialSummary, WorkOrderSummary, KpiSummary } from '../../reports.models';
import { Subject, forkJoin, EMPTY, of } from 'rxjs';
import { takeUntil, catchError, finalize } from 'rxjs/operators';

@Component({
  selector: 'app-reports-page',
  templateUrl: './reports-page.component.html',
  styleUrls: ['./reports-page.component.css']
})
export class ReportsPageComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  isLoading = false;
  loadingMessage = '';
  tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'financial', label: 'Financial' },
    { key: 'workOrders', label: 'Work Orders' },
    { key: 'inventory', label: 'Inventory' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'customers', label: 'Customers' }
  ];

  activeTab = 'dashboard';
  filters: ReportFilters = {};
  locations: any[] = [];
  loadedTabs: Record<string, boolean> = {};

  kpiSummary: KpiSummary | null = null;
  financialSummary: FinancialSummary | null = null;
  revenueByLocation: any[] = [];
  workOrderSummary: WorkOrderSummary | null = null;
  workOrderStatus: any[] = [];
  revenueTrendLabels: string[] = [];
  revenueTrendData: number[] = [];
  workOrderTypeLabels: string[] = [];
  workOrderTypeData: number[] = [];

  inventoryStatusRows: any[] = [];
  lowStockRows: any[] = [];
  inventoryValuationRows: any[] = [];

  vehicleSummaryRows: any[] = [];
  vehicleStatusRows: any[] = [];
  vehicleMaintenanceRows: any[] = [];

  customerSummaryRows: any[] = [];
  customerActivityRows: any[] = [];
  customerAgingRows: any[] = [];

  role: string | null = null;

  financialRevenueColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'total_invoiced', label: 'Total Invoiced', format: (v: any) => `$${Number(v || 0).toFixed(2)}` },
    { key: 'total_paid', label: 'Total Paid', format: (v: any) => `$${Number(v || 0).toFixed(2)}` },
    { key: 'total_outstanding', label: 'Outstanding', format: (v: any) => `$${Number(v || 0).toFixed(2)}` }
  ];

  workOrderStatusColumns = [
    { key: 'status', label: 'Status' },
    { key: 'count', label: 'Count' }
  ];

  inventoryStatusColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'sku', label: 'SKU' },
    { key: 'part_name', label: 'Part' },
    { key: 'category', label: 'Category' },
    { key: 'on_hand_qty', label: 'On Hand' },
    { key: 'reserved_qty', label: 'Reserved' },
    { key: 'available_qty', label: 'Available' },
    { key: 'min_stock_level', label: 'Min' },
    { key: 'reorder_qty', label: 'Reorder' },
    { key: 'status', label: 'Status' }
  ];

  lowStockColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'sku', label: 'SKU' },
    { key: 'part_name', label: 'Part' },
    { key: 'on_hand_qty', label: 'On Hand' },
    { key: 'available_qty', label: 'Available' },
    { key: 'min_stock_level', label: 'Min' },
    { key: 'reorder_qty', label: 'Reorder' },
    { key: 'severity', label: 'Severity' }
  ];

  inventoryValuationColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'sku', label: 'SKU' },
    { key: 'part_name', label: 'Part' },
    { key: 'category', label: 'Category' },
    { key: 'on_hand_qty', label: 'On Hand' },
    { key: 'unit_cost', label: 'Unit Cost' },
    { key: 'total_value', label: 'Total Value' }
  ];

  vehicleSummaryColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'unit_number', label: 'Unit' },
    { key: 'vin', label: 'VIN' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'year', label: 'Year' },
    { key: 'status', label: 'Status' },
    { key: 'mileage', label: 'Mileage' },
    { key: 'next_pm_due', label: 'Next PM Due' },
    { key: 'inspection_expiry', label: 'Inspection Exp' }
  ];

  vehicleStatusColumns = [
    { key: 'status', label: 'Status' },
    { key: 'count', label: 'Count' }
  ];

  vehicleMaintenanceColumns = [
    { key: 'location_name', label: 'Location' },
    { key: 'unit_number', label: 'Unit' },
    { key: 'vin', label: 'VIN' },
    { key: 'status', label: 'Status' },
    { key: 'next_pm_due', label: 'Next PM Due' },
    { key: 'next_pm_mileage', label: 'Next PM Mileage' }
  ];

  customerSummaryColumns = [
    { key: 'company_name', label: 'Customer' },
    { key: 'invoice_count', label: 'Invoices' },
    { key: 'total_invoiced', label: 'Total Invoiced' },
    { key: 'total_paid', label: 'Total Paid' },
    { key: 'total_outstanding', label: 'Outstanding' },
    { key: 'last_invoice_date', label: 'Last Invoice' },
    { key: 'work_orders_count', label: 'WOs' },
    { key: 'last_work_order_date', label: 'Last WO' }
  ];

  customerActivityColumns = [
    { key: 'company_name', label: 'Customer' },
    { key: 'invoice_count', label: 'Invoices' },
    { key: 'work_orders_count', label: 'WOs' },
    { key: 'total_invoiced', label: 'Total Invoiced' },
    { key: 'total_paid', label: 'Total Paid' },
    { key: 'total_outstanding', label: 'Outstanding' },
    { key: 'last_invoice_date', label: 'Last Invoice' },
    { key: 'last_work_order_date', label: 'Last WO' }
  ];

  customerAgingColumns = [
    { key: 'company_name', label: 'Customer' },
    { key: 'bucket_0_30', label: '0-30' },
    { key: 'bucket_31_60', label: '31-60' },
    { key: 'bucket_61_90', label: '61-90' },
    { key: 'bucket_90_plus', label: '90+' },
    { key: 'total_outstanding', label: 'Total' }
  ];

  constructor(private apiService: ApiService, private reportsService: ReportsService) {}

  ngOnInit(): void {
    try {
      console.log('[Reports] ngOnInit starting', new Date().toISOString());
      this.role = (localStorage.getItem('role') || '').toLowerCase().trim();
      if (!this.role) {
        this.role = this.getRoleFromToken();
      }
      console.log('[Reports] role loaded:', this.role);

      this.reportsService.invalidateCache();
      
      console.log('[Reports] calling loadLocations');
      this.loadLocations();
      
      console.log('[Reports] calling loadTabData for', this.activeTab);
      this.loadTabData(this.activeTab, true);
      if (this.role === 'admin') {
        this.tabs.forEach(tab => {
          if (tab.key !== this.activeTab) {
            this.loadTabData(tab.key, true);
          }
        });
      }
      
      console.log('[Reports] ngOnInit complete', new Date().toISOString());
    } catch (error) {
      console.error('[Reports] ngOnInit error:', error);
    }
  }

  private getRoleFromToken(): string {
    try {
      const token = localStorage.getItem('token');
      if (!token) return '';
      const payload = token.split('.')[1];
      if (!payload) return '';
      const decoded = JSON.parse(atob(payload));
      return (decoded?.role || '').toString().toLowerCase().trim();
    } catch {
      return '';
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadLocations(): void {
    console.log('[Reports] loadLocations starting');
    this.apiService.getLocations().subscribe({
      next: (data) => { 
        console.log('[Reports] Locations loaded successfully:', data?.length || 0, 'locations');
        this.locations = data || []; 
      },
      error: (err) => {
        console.error('[Reports] Locations load error:', err);
        this.locations = [];
      },
      complete: () => {
        console.log('[Reports] Locations stream completed');
      }
    });
  }

  setTab(tab: string): void {
    console.log('[Reports] setTab called with:', tab);
    this.activeTab = tab;
    this.loadTabData(tab);
  }

  applyFilters(filters: ReportFilters): void {
    this.filters = filters;
    this.loadedTabs = {};
    this.reportsService.invalidateCache();
    this.loadTabData(this.activeTab, true);
  }

  clearFilters(): void {
    this.filters = {};
    this.loadedTabs = {};
    this.reportsService.invalidateCache();
    this.loadTabData(this.activeTab, true);
  }

  loadTabData(tab: string, force = false): void {
    console.log('[Reports] loadTabData called:', { tab, force, alreadyLoaded: this.loadedTabs[tab] });
    if (!force && this.loadedTabs[tab]) {
      console.log('[Reports] tab already loaded, skipping');
      return;
    }
    
    console.log('[Reports] loading tab:', tab);
    if (tab === 'dashboard') {
      console.log('[Reports] calling loadDashboard');
      this.loadDashboard();
    }
    if (tab === 'financial') {
      console.log('[Reports] calling loadFinancial');
      this.loadFinancial();
    }
    if (tab === 'workOrders') {
      console.log('[Reports] calling loadWorkOrders');
      this.loadWorkOrders();
    }
    if (tab === 'inventory') {
      console.log('[Reports] calling loadInventory');
      this.loadInventory();
    }
    if (tab === 'vehicles') {
      console.log('[Reports] calling loadVehicles');
      this.loadVehicles();
    }
    if (tab === 'customers') {
      console.log('[Reports] calling loadCustomers');
      this.loadCustomers();
    }
    this.loadedTabs[tab] = true;
    console.log('[Reports] loadTabData complete for:', tab);
  }

  loadDashboard(): void {
    console.log('[Reports] loadDashboard starting');
    this.isLoading = true;
    this.loadingMessage = 'Loading dashboard...';
    
    forkJoin({
      kpis: this.reportsService.getDashboardKpis(this.filters)
        .pipe(
          takeUntil(this.destroy$),
          catchError(err => { 
            console.error('[Reports] KPI error:', err); 
            return of({ success: false, data: null });
          })
        ),
      charts: this.reportsService.getDashboardCharts(this.filters)
        .pipe(
          takeUntil(this.destroy$),
          catchError(err => { 
            console.error('[Reports] Chart error:', err); 
            return of({ success: false, data: {} });
          })
        )
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => { 
        console.log('[Reports] loadDashboard finalized');
        this.isLoading = false; 
        this.loadingMessage = ''; 
      })
    ).subscribe({
      next: (results: any) => {
        console.log('[Reports] Dashboard data received:', results);
        this.kpiSummary = results?.kpis?.data || null;
        const data = results?.charts?.data || {};
        this.revenueTrendLabels = (data.revenueTrend || []).map((r: any) => new Date(r.period).toISOString().slice(0, 10));
        this.revenueTrendData = (data.revenueTrend || []).map((r: any) => Number(r.total || 0));
        this.workOrderTypeLabels = (data.workOrdersByType || []).map((r: any) => r.type || 'Unknown');
        this.workOrderTypeData = (data.workOrdersByType || []).map((r: any) => Number(r.count || 0));
        console.log('[Reports] Dashboard processing complete');
      },
      error: (err) => { 
        console.error('[Reports] Dashboard subscription error:', err);
        this.isLoading = false;
        this.loadingMessage = '';
      }
    });
  }

  loadFinancial(): void {
    console.log('[Reports] loadFinancial starting');
    this.isLoading = true;
    this.loadingMessage = 'Loading financial data...';
    
    this.reportsService.getFinancialSummary(this.filters)
      .pipe(
        takeUntil(this.destroy$),
        catchError(err => { 
          console.error('[Reports] Financial error:', err); 
          return of({ success: false, data: { summary: null, revenueByLocation: [] } });
        }),
        finalize(() => { 
          console.log('[Reports] loadFinancial finalized');
          this.isLoading = false; 
          this.loadingMessage = ''; 
        })
      )
      .subscribe({
        next: (res: any) => {
          console.log('[Reports] Financial data received');
          this.financialSummary = res?.data?.summary || null;
          this.revenueByLocation = res?.data?.revenueByLocation || [];
        },
        error: (err) => {
          console.error('[Reports] Financial subscription error:', err);
          this.isLoading = false;
          this.loadingMessage = '';
        }
      });
  }

  loadWorkOrders(): void {
    console.log('[Reports] loadWorkOrders starting');
    this.isLoading = true;
    this.loadingMessage = 'Loading work order data...';
    
    this.reportsService.getWorkOrderSummary(this.filters)
      .pipe(
        takeUntil(this.destroy$),
        catchError(err => { 
          console.error('[Reports] Work order error:', err); 
          return of({ success: false, data: { summary: null, byStatus: [] } });
        }),
        finalize(() => { 
          console.log('[Reports] loadWorkOrders finalized');
          this.isLoading = false; 
          this.loadingMessage = ''; 
        })
      )
      .subscribe({
        next: (res: any) => {
          console.log('[Reports] Work order data received');
          this.workOrderSummary = res?.data?.summary || null;
          this.workOrderStatus = res?.data?.byStatus || [];
        },
        error: (err) => {
          console.error('[Reports] Work order subscription error:', err);
          this.isLoading = false;
          this.loadingMessage = '';
        }
      });
  }

  loadInventory(): void {
    console.log('[Reports] loadInventory starting');
    const params = this.buildHeavyFilters();
    this.isLoading = true;
    this.loadingMessage = 'Loading inventory data...';
    
    forkJoin({
      status: this.reportsService.getInventoryStatus(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Inventory status error:', err);
          return of({ success: false, data: [] });
        })),
      lowStock: this.reportsService.getLowStock(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Low stock error:', err);
          return of({ success: false, data: [] });
        })),
      valuation: this.reportsService.getInventoryValuation(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Valuation error:', err);
          return of({ success: false, data: [] });
        }))
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => { 
        console.log('[Reports] loadInventory finalized');
        this.isLoading = false; 
        this.loadingMessage = ''; 
      })
    ).subscribe({
      next: (results: any) => {
        console.log('[Reports] Inventory data received');
        this.inventoryStatusRows = results?.status?.data || [];
        this.lowStockRows = results?.lowStock?.data || [];
        this.inventoryValuationRows = results?.valuation?.data || [];
        console.log('[Reports] Inventory processing complete');
      },
      error: (err) => {
        console.error('[Reports] Inventory subscription error:', err);
        this.isLoading = false;
        this.loadingMessage = '';
      }
    });
  }

  loadVehicles(): void {
    console.log('[Reports] loadVehicles starting');
    const params = this.buildHeavyFilters();
    this.isLoading = true;
    this.loadingMessage = 'Loading vehicle data...';
    
    forkJoin({
      summary: this.reportsService.getVehicleSummary(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Vehicle summary error:', err);
          return of({ success: false, data: [] });
        })),
      status: this.reportsService.getVehicleStatus(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Vehicle status error:', err);
          return of({ success: false, data: [] });
        })),
      maintenance: this.reportsService.getVehicleMaintenance(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Maintenance error:', err);
          return of({ success: false, data: [] });
        }))
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => { 
        console.log('[Reports] loadVehicles finalized');
        this.isLoading = false; 
        this.loadingMessage = ''; 
      })
    ).subscribe({
      next: (results: any) => {
        console.log('[Reports] Vehicle data received');
        this.vehicleSummaryRows = results?.summary?.data || [];
        this.vehicleStatusRows = results?.status?.data || [];
        this.vehicleMaintenanceRows = results?.maintenance?.data || [];
        console.log('[Reports] Vehicle processing complete');
      },
      error: (err) => {
        console.error('[Reports] Vehicle subscription error:', err);
        this.isLoading = false;
        this.loadingMessage = '';
      }
    });
  }

  loadCustomers(): void {
    console.log('[Reports] loadCustomers starting');
    const params = this.buildHeavyFilters();
    this.isLoading = true;
    this.loadingMessage = 'Loading customer data...';
    
    forkJoin({
      summary: this.reportsService.getCustomerSummary(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Customer summary error:', err);
          return of({ success: false, data: [] });
        })),
      activity: this.reportsService.getCustomerActivity(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Activity error:', err);
          return of({ success: false, data: [] });
        })),
      aging: this.reportsService.getCustomerAging(params)
        .pipe(catchError(err => { 
          console.error('[Reports] Aging error:', err);
          return of({ success: false, data: [] });
        }))
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => { 
        console.log('[Reports] loadCustomers finalized');
        this.isLoading = false; 
        this.loadingMessage = ''; 
      })
    ).subscribe({
      next: (results: any) => {
        console.log('[Reports] Customer data received');
        this.customerSummaryRows = results?.summary?.data || [];
        this.customerActivityRows = results?.activity?.data || [];
        this.customerAgingRows = results?.aging?.data || [];
        console.log('[Reports] Customer processing complete');
      },
      error: (err) => {
        console.error('[Reports] Customer subscription error:', err);
        this.isLoading = false;
        this.loadingMessage = '';
      }
    });
  }

  buildHeavyFilters(): ReportFilters {
    return {
      ...this.filters,
      limit: this.filters.limit ?? 200,
      offset: this.filters.offset ?? 0
    };
  }

  formatCurrency(value: any): string {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  formatDate(value: any): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  canSeeTab(tab: string): boolean {
    if (!this.role) return false;
    if (this.role === 'admin') return true;
    if (tab === 'financial') return this.role === 'accounting';
    if (tab === 'workOrders') return this.role === 'service_advisor';
    if (tab === 'inventory') return ['inventory_manager', 'parts_manager', 'shop_manager', 'technician'].includes(this.role);
    if (tab === 'customers') return ['accounting', 'service_advisor', 'admin'].includes(this.role);
    if (tab === 'vehicles') return ['admin', 'service_advisor', 'safety'].includes(this.role);
    if (tab === 'dashboard') return true;
    return false;
  }

  get dashboardKpis(): Array<{ label: string; value: string | number }> {
    if (!this.kpiSummary) return [];
    return [
      { label: 'Total Revenue (MTD)', value: `$${this.formatNumber(this.kpiSummary.totalRevenueMtd).toFixed(2)}` },
      { label: 'Open Work Orders', value: this.kpiSummary.openWorkOrders },
      { label: 'Vehicles OOS', value: this.kpiSummary.vehiclesOutOfService },
      { label: 'Inventory Value', value: `$${this.formatNumber(this.kpiSummary.inventoryValue).toFixed(2)}` },
      { label: 'Low Stock Items', value: this.kpiSummary.lowStockItems },
      { label: 'Avg WO Completion (hrs)', value: this.formatNumber(this.kpiSummary.avgCompletionHours).toFixed(2) }
    ];
  }

  get financialKpis(): Array<{ label: string; value: string | number }> {
    if (!this.financialSummary) return [];
    return [
      { label: 'Total Invoiced', value: `$${this.formatNumber(this.financialSummary.totalInvoiced).toFixed(2)}` },
      { label: 'Total Paid', value: `$${this.formatNumber(this.financialSummary.totalPaid).toFixed(2)}` },
      { label: 'Outstanding', value: `$${this.formatNumber(this.financialSummary.totalOutstanding).toFixed(2)}` },
      { label: 'Avg Invoice', value: `$${this.formatNumber(this.financialSummary.averageInvoice).toFixed(2)}` }
    ];
  }

  get workOrderKpis(): Array<{ label: string; value: string | number }> {
    if (!this.workOrderSummary) return [];
    return [
      { label: 'Total WOs', value: this.workOrderSummary.total },
      { label: 'Completed WOs', value: this.workOrderSummary.completed },
      { label: 'Open WOs', value: this.workOrderSummary.open },
      { label: 'Avg Completion (hrs)', value: this.formatNumber(this.workOrderSummary.avgCompletionHours).toFixed(2) }
    ];
  }

  get showAllTabs(): boolean {
    return this.role === 'admin';
  }

  private formatNumber(value: any): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
}
