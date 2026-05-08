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
      next: (data: any) => {
        const rows = data?.rows || data?.data || data || [];
        this.vehicles = (Array.isArray(rows) ? rows : []).map((v: any) => ({
          ...v,
          customer_id: v.customer_id ?? v.customerId ?? null
        }));
      },
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
      next: (data: any) => {
        const rows = data?.data || data?.rows || data || [];
        this.locations = Array.isArray(rows) ? rows : [];
      },
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
          scheduledDate: this.toDateInputValue(wo.scheduled_date ?? wo.scheduledDate),
          startDate: this.toDateInputValue(wo.start_date ?? wo.startDate),
          completionDate: this.toDateInputValue(wo.completion_date ?? wo.completionDate ?? wo.completed_at),
          currentOdometer: wo.odometer_miles || '', assignedTo: wo.assigned_mechanic_user_id || '',
          serviceCategory: wo.service_category ?? wo.serviceCategory ?? '',
          serviceDescription: wo.service_description ?? wo.serviceDescription ?? '',
          problemReported: wo.problem_reported ?? wo.problemReported ?? '',
          safetyIssue: wo.safety_issue ?? wo.safetyIssue ?? '',
          downtimeReason: wo.downtime_reason ?? wo.downtimeReason ?? '',
          roadCall: (wo.road_call ?? wo.roadCall) === true,
          breakdownLocation: wo.breakdown_location ?? wo.breakdownLocation ?? '',
          estimatedDurationHours: wo.estimated_duration_hours ?? wo.estimatedDurationHours ?? ''
        });
        // Server-computed financials (FN-1538 tax engine). These win over client estimates.
        const laborSubtotal = Number(wo.labor_subtotal || 0);
        const partsSubtotal = Number(wo.parts_subtotal || 0);
        const feesSubtotal = Number(wo.fees_subtotal || 0);
        this.workOrder.laborSubtotal = laborSubtotal;
        this.workOrder.partsSubtotal = partsSubtotal;
        this.workOrder.feesSubtotal = feesSubtotal;
        this.workOrder.tax = Number(Number(wo.tax_amount || 0).toFixed(2));
        this.workOrder.totalCost = Number(Number(wo.total_amount || 0).toFixed(2));
        this.workOrder.actualCost = Number((laborSubtotal + partsSubtotal + feesSubtotal).toFixed(2));
        this.workOrder.taxRatePercent = wo.tax_rate_percent != null ? Number(wo.tax_rate_percent) : null;
        this.workOrder.taxRateOverride = wo.tax_rate_override === true;
        this.workOrder.taxBreakdown = this.parseTaxBreakdown(wo.tax_breakdown);
        const rbn = payload.requestedBy?.username
          || (payload.requestedBy?.first_name && payload.requestedBy?.last_name
            ? `${payload.requestedBy.first_name}.${payload.requestedBy.last_name}`.toLowerCase() : '')
          || wo.requested_by_username || wo.requestedBy || this.workOrder.requestedBy || '';
        this.workOrder.requestedBy = this.isLikelyUuid(rbn) ? '' : rbn;
        if (!this.workOrder.requestedBy) this.setRequestedByFromCurrentUser();
        const vehicle = payload.vehicle || {};
        this.workOrder.unitNumber = vehicle.unit_number || wo.vehicle_unit || '';
        this.workOrder.vin = vehicle.vin || wo.vehicle_vin || '';
        this.workOrder.make = vehicle.make || '';
        this.workOrder.model = vehicle.model || '';
        this.workOrder.year = vehicle.year ?? '';
        this.workOrder.licensePlate = vehicle.license_plate || vehicle.licensePlate || this.workOrder.licensePlate || '';
        this.workOrder.vehicleType = vehicle.type || vehicle.vehicle_type || this.workOrder.vehicleType || '';
        this.documents = payload.documents || [];
        this.invoiceInfo = (payload.invoices?.length) ? payload.invoices[0] : null;
        this.workOrderParts = payload.parts || [];
        this.workOrder.labor = Array.isArray(payload.labor) && payload.labor.length
          ? payload.labor.map((l: any) => ({ ...l, mechanicName: l.mechanicName || l.mechanic_username || '', rate: l.rate ?? l.labor_rate ?? '', cost: l.cost ?? l.line_total ?? '' }))
          : [];
        this.recomputeActualCost();
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
    this.recomputeActualCost();

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
      scheduledDate: this.toDateInputValue(this.workOrder.scheduledDate) || null,
      startDate: this.toDateInputValue(this.workOrder.startDate) || null,
      completionDate: this.toDateInputValue(this.workOrder.completionDate) || null,
      labor: laborLines,
      fees: this.workOrder.fees || [],
      discountType: this.workOrder.discountType,
      discountValue: this.workOrder.discountValue,
      taxRatePercent: this.workOrder.taxRatePercent ?? this.partsTaxRate,
      taxRateOverride: this.workOrder.taxRateOverride === true,
      serviceCategory: this.workOrder.serviceCategory ?? '',
      serviceDescription: this.workOrder.serviceDescription ?? '',
      problemReported: this.workOrder.problemReported ?? '',
      safetyIssue: this.workOrder.safetyIssue ?? '',
      downtimeReason: this.workOrder.downtimeReason ?? '',
      roadCall: this.workOrder.roadCall === true,
      breakdownLocation: this.workOrder.breakdownLocation ?? '',
      estimatedDurationHours: this.workOrder.estimatedDurationHours ?? ''
    };

    const save$ = this.isEditMode && this.workOrderId
      ? this.apiService.updateWorkOrder(this.workOrderId, payload)
      : this.apiService.createWorkOrder(payload);

    save$.subscribe({
      next: (saved) => {
        const savedData = saved?.data || saved;
        const workOrderId = savedData?.id || this.workOrderId;
        this.workOrder.workOrderNumber = savedData?.work_order_number || savedData?.id || this.workOrder.workOrderNumber;

        // Handle auto-generated invoice returned from server on COMPLETED transition
        if (saved?.invoice) {
          this.invoiceInfo = saved.invoice;
          const invNum = saved.invoice.invoice_number || saved.invoice.id;
          this.workOrderSaveSuccess = `Invoice #${invNum} created as draft.`;
        } else {
          this.workOrderSaveSuccess = this.isEditMode ? 'Work order updated successfully.' : 'Work order saved successfully.';
        }

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

  onWorkflowStatusChange(event: { newStatus: string; cancelReason?: string }): void {
    this.workOrder.status = event.newStatus;
    if (event.cancelReason) {
      this.workOrder.cancelReason = event.cancelReason;
    }
    this.submitWorkOrder();
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

  sendInvoice(): void {
    if (!this.invoiceInfo?.id) { return; }
    this.apiService.updateInvoiceStatus(this.invoiceInfo.id, 'SENT').subscribe({
      next: (res: any) => {
        this.invoiceInfo = res?.data || res;
        this.workOrderSaveSuccess = 'Invoice sent successfully.';
      },
      error: (err: any) => {
        this.creditCheckError = err?.error?.error || err?.message || 'Failed to send invoice';
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

  // Client-side preview of Actual Cost / Tax / Total. Server (FN-1538 engine)
  // is the source of truth on save; this keeps the Financials tab in sync with
  // unsaved Work-tab edits (labor lines, override-rate changes) so the user
  // does not have to save+reload to see the impact. recomputeFinancialsPreview
  // is intentionally idempotent and mirrors the server's taxable-subtotal logic
  // — when a tax_breakdown is present (loaded after a save), its taxable flags
  // and rate drive the preview; otherwise we fall back to the legacy
  // parts-only-at-8.5% rule that matches the server fallback.
  recomputeFinancialsPreview(): void {
    const labor = this.sumLaborCost();
    const parts = this.sumPartsCost();
    const fees = this.sumFeesAmount();
    const subtotal = labor + parts + fees;
    this.workOrder.actualCost = Number(subtotal.toFixed(2));

    const bd = this.workOrder?.taxBreakdown || null;
    const ratePct = this.resolveEffectiveRatePercent(bd);
    const taxableSubtotal = this.computeTaxableSubtotal(labor, parts, fees, bd);

    // Mirror server discount apportionment: discount reduces the taxable base
    // proportionally, not in full. Without this the preview can over-tax when
    // a percent / amount discount is applied.
    const discountAmount = this.computeDiscountAmount(subtotal);
    const taxableAfterDiscount = subtotal > 0
      ? taxableSubtotal - (discountAmount * (taxableSubtotal / subtotal))
      : taxableSubtotal;

    const tax = Number(((taxableAfterDiscount * ratePct) / 100).toFixed(2));
    this.workOrder.tax = tax;
    this.workOrder.totalCost = Number((subtotal - discountAmount + tax).toFixed(2));
  }

  private computeDiscountAmount(subtotal: number): number {
    const type = (this.workOrder?.discountType || 'NONE').toString().toUpperCase();
    const val = Number(this.workOrder?.discountValue) || 0;
    if (type === 'PERCENT') return subtotal * (val / 100);
    if (type === 'AMOUNT') return val;
    return 0;
  }

  private sumLaborCost(): number {
    return (this.workOrder.labor || []).reduce((s: number, l: any) => s + (Number(l.cost) || Number(l.line_total) || 0), 0);
  }

  private sumPartsCost(): number {
    return (this.workOrderParts || []).reduce((s: number, l: any) => {
      const lt = Number(l.line_total); if (!Number.isNaN(lt) && lt > 0) return s + lt;
      return s + ((Number(l.qty_issued) || 0) * (Number(l.unit_price) || 0));
    }, 0);
  }

  private sumFeesAmount(): number {
    return (this.workOrder.fees || []).reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
  }

  private resolveEffectiveRatePercent(bd: any): number {
    if (this.workOrder?.taxRateOverride === true) {
      const rp = Number(this.workOrder?.taxRatePercent);
      return Number.isFinite(rp) ? rp : 0;
    }
    if (bd && typeof bd.rate === 'number') return bd.rate * 100;
    const rp = Number(this.workOrder?.taxRatePercent);
    if (Number.isFinite(rp) && rp > 0) return rp;
    return this.partsTaxRate;
  }

  private computeTaxableSubtotal(labor: number, parts: number, fees: number, bd: any): number {
    if (!bd) return parts;
    const partsTaxable = bd.parts_taxable !== false;
    const laborTaxable = bd.labor_taxable === true;
    const feesTaxable = bd.fees_taxable === true;
    return (partsTaxable ? parts : 0) + (laborTaxable ? labor : 0) + (feesTaxable ? fees : 0);
  }

  // Updates Actual Cost only (labor + parts + fees). Used at load time, where
  // the server already provided authoritative tax / total amounts and we don't
  // want to overwrite them with a client preview.
  private recomputeActualCost(): void {
    const subtotal = this.sumLaborCost() + this.sumPartsCost() + this.sumFeesAmount();
    this.workOrder.actualCost = Number(subtotal.toFixed(2));
  }

  private parseTaxBreakdown(raw: any): any {
    if (!raw) return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw;
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

  private toDateInputValue(value: any): string {
    if (value == null) return '';
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      const y = value.getFullYear();
      const mo = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    const s = String(value).trim();
    if (!s) return '';
    return s.length >= 10 ? s.slice(0, 10) : s;
  }

  canEditWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_EDIT, PERMISSIONS.WORK_ORDERS_CREATE]); }
  private canCloseWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.WORK_ORDERS_CLOSE, PERMISSIONS.WORK_ORDERS_FINALIZE]); }
  private canGenerateDraftInvoiceFromWorkOrder(): boolean { return this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]); }
  private isClosingStatusSelected(): boolean { return (this.workOrder?.status || '').toString().toUpperCase() === 'CLOSED'; }
}
