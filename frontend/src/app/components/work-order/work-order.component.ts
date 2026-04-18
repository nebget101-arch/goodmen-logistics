import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { CreditService } from '../../services/credit.service';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';
import { WoBasicsTabComponent } from './tabs/basics-tab/basics-tab.component';

@Component({
  selector: 'app-work-order',
  templateUrl: './work-order.component.html',
  styleUrls: ['./work-order.component.css']
})
export class WorkOrderComponent implements OnInit, OnDestroy {
  readonly perms = PERMISSIONS;
  private readonly partsTaxRate = 8.5;

  /* ─── Tab state ─── */
  activeTab = 'basics';
  readonly tabs = [
    { id: 'basics', label: 'Basics' },
    { id: 'service', label: 'Service Details' },
    { id: 'work', label: 'Work' },
    { id: 'financials', label: 'Financials' },
    { id: 'notes', label: 'Notes & Attachments' }
  ];

  /* ─── Core data ─── */
  workOrder: any = { vehicleId: null, customerId: null, shopLocationId: null, parts: [], labor: [] };
  vehicles: any[] = [];
  customers: any[] = [];
  locations: any[] = [];
  partsCatalog: any[] = [];
  technicians: any[] = [];

  /* ─── WO metadata ─── */
  isEditMode = false;
  workOrderId: string | null = null;
  documents: any[] = [];
  invoiceInfo: any = null;
  workOrderParts: any[] = [];
  files: File[] = [];

  /* ─── Messages ─── */
  workOrderLoadError = '';
  workOrderSaveError = '';
  workOrderSaveSuccess = '';

  /* ─── Credit ─── */
  availableCredit = 0;
  customerCreditLimit = 0;
  useCustomerCredit = false;
  creditCheckLoading = false;
  creditCheckError = '';

  /* ─── AI draft ─── */
  private aiWorkOrderDraft: any = null;

  @ViewChild('basicsTab') basicsTab!: WoBasicsTabComponent;

  constructor(
    private apiService: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private creditService: CreditService,
    private permissions: PermissionHelperService
  ) {}

  ngOnInit(): void {
    const nav = this.router.getCurrentNavigation();
    const stateDraft = (nav && (nav.extras.state as any)?.aiWorkOrderDraft) || (history.state as any)?.aiWorkOrderDraft || null;
    this.aiWorkOrderDraft = stateDraft;

    this.loadVehicles();
    this.loadCustomers();
    this.loadLocations();
    this.loadParts();
    this.loadTechnicians();
    this.initWorkOrder();
    this.setRequestedByFromCurrentUser();

    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditMode = true;
        this.workOrderId = id;
        this.loadWorkOrder(id);
      } else if (this.aiWorkOrderDraft) {
        this.applyAiWorkOrderDraft(this.aiWorkOrderDraft);
      }
    });
  }

  ngOnDestroy(): void { /* child tabs handle their own cleanup */ }

  setActiveTab(tabId: string): void { this.activeTab = tabId; }

  private loadVehicles(): void {
    this.apiService.getVehicles().subscribe({
      next: (data) => { this.vehicles = data; },
      error: () => { this.vehicles = []; }
    });
  }

  private loadCustomers(): void {
    this.apiService.getCustomers({ pageSize: 5000 }).subscribe({
      next: (data) => {
        const rows = data?.rows || data?.data || data || [];
        this.customers = rows.map((c: any) => ({
          ...c,
          company_name: c.company_name || c.companyName || c.name || '',
          displayName: c.company_name || c.companyName || c.name || ''
        }));
        setTimeout(() => {
          if (this.basicsTab) {
            this.basicsTab.populateCustomerDisplay();
          }
        }, 0);
      },
      error: () => { this.customers = []; }
    });
  }

  private loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data; },
      error: () => { this.locations = []; }
    });
  }

  private loadParts(): void {
    this.apiService.getParts({ pageSize: 10000 }).subscribe({
      next: (res: any) => { this.partsCatalog = res?.rows || res?.data || res || []; },
      error: () => { this.partsCatalog = []; }
    });
  }

  private loadTechnicians(): void {
    this.apiService.getTechnicians().subscribe({
      next: (res: any) => { this.technicians = res?.rows || res?.data || res || []; },
      error: () => { this.technicians = []; }
    });
  }

  loadWorkOrder(id: string): void {
    this.apiService.getWorkOrder(id).subscribe({
      next: (data) => {
        const payload = data?.data || data; if (!payload) return;
        const wo = payload.workOrder || payload;
        Object.assign(this.workOrder, {
          id: wo.id, workOrderNumber: wo.work_order_number || wo.workOrderNumber || '',
          vehicleId: wo.vehicle_id || wo.vehicleId, customerId: wo.customer_id || wo.customerId,
          shopLocationId: wo.location_id || wo.locationId, title: wo.description || '',
          type: wo.type || 'REPAIR', status: this.normalizeStatusForSelect(wo.status || 'DRAFT'),
          priority: wo.priority || '', requestDate: wo.created_at ? wo.created_at.slice(0, 10) : '',
          completionDate: wo.completed_at ? wo.completed_at.slice(0, 10) : '',
          currentOdometer: wo.odometer_miles || '', assignedTo: wo.assigned_mechanic_user_id || ''
        });
        const rbn = payload.requestedBy?.username
          || (payload.requestedBy?.first_name && payload.requestedBy?.last_name
            ? `${payload.requestedBy.first_name}.${payload.requestedBy.last_name}`.toLowerCase() : '')
          || wo.requested_by_username || wo.requestedBy || this.workOrder.requestedBy || '';
        this.workOrder.requestedBy = this.isLikelyUuid(rbn) ? '' : rbn;
        if (!this.workOrder.requestedBy) this.setRequestedByFromCurrentUser();
        const vehicle = payload.vehicle || {};
        this.workOrder.unitNumber = vehicle.unit_number || wo.vehicle_unit || '';
        this.workOrder.vin = vehicle.vin || wo.vehicle_vin || '';
        this.documents = payload.documents || [];
        this.invoiceInfo = (payload.invoices?.length) ? payload.invoices[0] : null;
        this.workOrderParts = payload.parts || [];
        this.workOrder.labor = Array.isArray(payload.labor) && payload.labor.length
          ? payload.labor.map((l: any) => ({ ...l, mechanicName: l.mechanicName || l.mechanic_username || '', rate: l.rate ?? l.labor_rate ?? '', cost: l.cost ?? l.line_total ?? '' }))
          : [];
        this.computeFinancials();
        this.populateUserDisplay(wo, this.workOrder.labor);
        if (!this.workOrder.requestedBy) this.setRequestedByFromCurrentUser();
        setTimeout(() => {
          if (this.basicsTab) { this.basicsTab.populateCustomerDisplay(); this.basicsTab.populateVehicleDisplay(); }
          if (this.workOrder.customerId) this.checkCustomerCredit(this.workOrder.customerId);
        }, 0);
      },
      error: (err) => { this.workOrderLoadError = err?.error?.error || err?.error?.message || 'Failed to load work order.'; }
    });
  }

  /* ─── Save ─── */

  submitWorkOrder(): void {
    if (!this.canEditWorkOrder()) {
      this.workOrderSaveError = 'You do not have permission to edit work orders.';
      return;
    }
    if (this.isClosingStatusSelected() && !this.canCloseWorkOrder()) {
      this.workOrderSaveError = 'Only manager-level users can close a work order.';
      return;
    }

    this.workOrderSaveError = '';
    this.workOrderSaveSuccess = '';
    this.setRequestedByFromCurrentUser();
    this.computeFinancials();

    const laborLines = (this.workOrder.labor || []).map((line: any) => {
      if (line?.mechanicId) return line;
      const name = (line?.mechanicName || '').trim().toLowerCase();
      if (!name) return line;
      const tech = this.technicians.find((t: any) => (t.username || '').toLowerCase() === name);
      return tech ? { ...line, mechanicId: tech.id } : line;
    });

    const payload: any = {
      vehicleId: this.workOrder.vehicleId,
      customerId: this.workOrder.customerId,
      locationId: this.workOrder.shopLocationId,
      type: this.workOrder.type,
      priority: this.workOrder.priority,
      status: this.workOrder.status,
      description: this.workOrder.title,
      odometerMiles: this.workOrder.currentOdometer,
      assignedMechanicUserId: this.getPrimaryMechanicId(),
      requestedBy: this.workOrder.requestedBy,
      labor: laborLines,
      fees: this.workOrder.fees || [],
      discountType: this.workOrder.discountType,
      discountValue: this.workOrder.discountValue,
      taxRatePercent: this.workOrder.taxRatePercent ?? this.partsTaxRate
    };

    const save$ = this.isEditMode && this.workOrderId
      ? this.apiService.updateWorkOrder(this.workOrderId, payload)
      : this.apiService.createWorkOrder(payload);

    save$.subscribe({
      next: (saved) => {
        const savedData = saved?.data || saved;
        const workOrderId = savedData?.id || this.workOrderId;
        this.workOrder.workOrderNumber = savedData?.work_order_number || savedData?.id || this.workOrder.workOrderNumber;
        this.workOrderSaveSuccess = this.isEditMode ? 'Work order updated successfully.' : 'Work order saved successfully.';
        if (workOrderId) {
          this.isEditMode = true;
          this.workOrderId = workOrderId;
          this.loadWorkOrder(workOrderId);
        }
      },
      error: (err) => {
        this.workOrderSaveError = err?.error?.message || 'Failed to save work order.';
      }
    });
  }

  cancelWorkOrder(): void { this.router.navigate(['/maintenance']); }

  generateInvoice(): void {
    if (!this.canGenerateDraftInvoiceFromWorkOrder()) {
      this.creditCheckError = 'You do not have permission to create draft invoices.';
      return;
    }
    if (!this.workOrderId) return;
    const payload: any = {};
    if (this.useCustomerCredit) payload.useCredit = true;
    if (this.invoiceInfo) payload.regenerate = true;

    this.apiService.generateInvoiceFromWorkOrder(this.workOrderId, payload).subscribe({
      next: (res: any) => {
        this.invoiceInfo = res?.data || res;
        this.creditCheckError = '';
        this.useCustomerCredit = false;
      },
      error: (error: any) => {
        this.creditCheckError = error?.error?.error || error?.message || 'Failed to generate invoice';
      }
    });
  }

  onWorkTabReload(): void { if (this.workOrderId) { this.loadWorkOrder(this.workOrderId); this.loadParts(); } }
  onNotesTabReload(): void { if (this.workOrderId) this.loadWorkOrder(this.workOrderId); }
  onCreditToggle(value: boolean): void { this.useCustomerCredit = value; }

  private initWorkOrder(): void {
    this.workOrder = {
      vehicleId: null, customerId: null, shopLocationId: null,
      unitNumber: '', vin: '', licensePlate: '', make: '', model: '', year: '',
      vehicleType: '', currentOdometer: '', engineHours: '', fleetTerminal: '',
      driverAssigned: '', vehicleStatus: '', parts: [], labor: []
    };
  }

  private applyAiWorkOrderDraft(draft: any): void {
    if (!draft) return;
    this.workOrder.title = draft.title || this.workOrder.title || '';
    this.workOrder.priority = draft.priority || this.workOrder.priority || '';
    if (draft.assetId) {
      this.workOrder.vehicleId = draft.assetId;
      if (this.basicsTab) this.basicsTab.onVehicleSelect();
    }
  }

  private computeFinancials(): void {
    const labor = (this.workOrder.labor || []).reduce((s: number, l: any) => s + (Number(l.cost) || Number(l.line_total) || 0), 0);
    const parts = (this.workOrderParts || []).reduce((s: number, l: any) => {
      const lt = Number(l.line_total); if (!Number.isNaN(lt) && lt > 0) return s + lt;
      return s + ((Number(l.qty_issued) || 0) * (Number(l.unit_price) || 0));
    }, 0);
    const tax = parts * (this.partsTaxRate / 100), total = labor + parts;
    this.workOrder.actualCost = Number(total.toFixed(2));
    this.workOrder.tax = Number(tax.toFixed(2));
    this.workOrder.totalCost = Number((total + tax).toFixed(2));
    this.workOrder.taxRatePercent = this.partsTaxRate;
  }

  private setRequestedByFromCurrentUser(): void {
    if (this.workOrder?.requestedBy) return;
    const dn = localStorage.getItem('displayName'), un = localStorage.getItem('username');
    const sd = dn && !this.isLikelyUuid(dn) ? dn : '', su = un && !this.isLikelyUuid(un) ? un : '';
    if (sd || su) { this.workOrder.requestedBy = sd || su || ''; return; }
    const token = localStorage.getItem('token');
    if (!token) return;
    try { const p = JSON.parse(atob(token.split('.')[1] || '')); const u = p?.username || '';
      if (u && !this.isLikelyUuid(u)) { this.workOrder.requestedBy = u; localStorage.setItem('username', u); }
    } catch { /* ignore */ }
  }

  private normalizeStatusForSelect(s: string): string {
    const v = (s || '').toString().trim();
    if (!v) return 'DRAFT';
    return v.includes('_') ? v.toUpperCase() : v.replace(/[\s-]+/g, '_').toUpperCase();
  }

  private populateUserDisplay(workOrder: any, laborLines: any[]): void {
    const requestedById = workOrder?.requested_by_user_id;
    if (requestedById && !this.workOrder.requestedBy) {
      this.apiService.getUserById(requestedById).subscribe({
        next: (res: any) => {
          const user = res?.data || res;
          const display = this.formatUserDisplay(user);
          if (display) this.workOrder.requestedBy = display;
        }
      });
    }
    const ids = new Set<string>();
    const assignedId = workOrder?.assigned_mechanic_user_id;
    if (assignedId) ids.add(assignedId);
    (laborLines || []).forEach((line: any) => { if (line?.mechanic_user_id) ids.add(line.mechanic_user_id); });
    ids.forEach(id => {
      this.apiService.getUserById(id).subscribe({
        next: (res: any) => {
          const user = res?.data || res;
          const display = this.formatUserDisplay(user);
          if (!display) return;
          (this.workOrder.labor || []).forEach((line: any) => {
            const matchesLine = line.mechanic_user_id && String(line.mechanic_user_id) === String(user.id);
            const useAssigned = !line.mechanic_user_id && assignedId && String(user.id) === String(assignedId);
            if (!line.mechanicName && (matchesLine || useAssigned)) line.mechanicName = display;
          });
          this.updateAssignedToFromLabor();
          if (!this.workOrder.assignedTo && assignedId && String(user.id) === String(assignedId)) {
            this.workOrder.assignedTo = display;
          }
        }
      });
    });
  }

  private formatUserDisplay(user: any): string {
    if (!user) return '';
    if (user.username) return user.username;
    if (user.first_name && user.last_name) return `${user.first_name}.${user.last_name}`.toLowerCase();
    return user.email || '';
  }

  private updateAssignedToFromLabor(): void {
    const names = (this.workOrder.labor || []).map((l: any) => (l?.mechanicName || '').trim()).filter((n: string) => n.length > 0);
    this.workOrder.assignedTo = Array.from(new Set(names)).join(', ');
  }

  private getPrimaryMechanicId(): string | null {
    return (this.workOrder.labor || []).find((l: any) => !!l?.mechanicId)?.mechanicId || null;
  }

  private checkCustomerCredit(customerId: string): void {
    if (!customerId) { this.availableCredit = 0; this.customerCreditLimit = 0; return; }
    this.creditCheckLoading = true;
    this.creditService.getCustomerCreditBalance(customerId).subscribe({
      next: (r: any) => { this.customerCreditLimit = r?.data?.credit_limit || 0; this.availableCredit = r?.data?.available_credit || 0; this.creditCheckLoading = false; this.creditCheckError = ''; },
      error: () => { this.availableCredit = 0; this.customerCreditLimit = 0; this.creditCheckLoading = false; }
    });
  }

  private isLikelyUuid(v: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((v || '').trim()); }

  canEditWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_EDIT, PERMISSIONS.WORK_ORDERS_CREATE]); }
  private canCloseWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_CLOSE, PERMISSIONS.WORK_ORDERS_FINALIZE]); }
  private canGenerateDraftInvoiceFromWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]); }
  private isClosingStatusSelected(): boolean { return (this.workOrder?.status || '').toString().toUpperCase() === 'CLOSED'; }
}
