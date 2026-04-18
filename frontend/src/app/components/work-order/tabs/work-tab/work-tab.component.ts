import { Component, Input, Output, EventEmitter, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { lastValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-wo-work-tab',
  templateUrl: './work-tab.component.html',
  styleUrls: ['./work-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoWorkTabComponent implements OnDestroy {
  @Input() workOrder: any = {};
  @Input() workOrderId: string | null = null;
  @Input() partsCatalog: any[] = [];
  @Input() locations: any[] = [];
  @Input() technicians: any[] = [];
  @Input() workOrderParts: any[] = [];

  @Output() reloadWorkOrder = new EventEmitter<void>();

  // ─── Add Part dialog ───────────────────────────────────────────────────────
  showAddPartDialog = false;
  dialogMode: 'catalog' | 'barcode' | 'manual' = 'catalog';
  dialogError = '';
  dialogSuccess = '';
  dialogSubmitting = false;
  dialogLocationId = '';

  // Catalog mode
  catalogSearch = '';
  catalogFiltered: any[] = [];
  catalogSelected: any = null;
  catalogQty = 1;
  catalogPrice: number | null = null;
  catalogShowDropdown = false;
  stockWarning = '';

  // Barcode mode
  dialogBarcodeInput = '';
  dialogBarcodeProcessing = false;

  // Manual mode
  manualSku = '';
  manualName = '';
  manualQty = 1;
  manualPrice = 0;

  // ─── Bulk actions ──────────────────────────────────────────────────────────
  bulkActioning = false;
  bulkError = '';

  // ─── Phone bridge ──────────────────────────────────────────────────────────
  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  bridgeEvents: EventSource | null = null;
  qrCodeDataUrl = '';
  bridgeError = '';

  // ─── Technician dropdown ───────────────────────────────────────────────────
  activeMechanicIndex: number | null = null;

  constructor(private apiService: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnDestroy(): void {
    this.stopPhoneBridge();
  }

  // ─── Add Part dialog ───────────────────────────────────────────────────────

  openAddPartDialog(): void {
    this.dialogLocationId = this.workOrder?.shopLocationId || '';
    this.dialogMode = 'catalog';
    this.dialogError = '';
    this.dialogSuccess = '';
    this.dialogSubmitting = false;
    this.catalogSearch = '';
    this.catalogFiltered = [];
    this.catalogSelected = null;
    this.catalogQty = 1;
    this.catalogPrice = null;
    this.catalogShowDropdown = false;
    this.stockWarning = '';
    this.dialogBarcodeInput = '';
    this.dialogBarcodeProcessing = false;
    this.manualSku = '';
    this.manualName = '';
    this.manualQty = 1;
    this.manualPrice = 0;
    this.showAddPartDialog = true;
    this.cdr.markForCheck();
  }

  closeAddPartDialog(): void {
    this.showAddPartDialog = false;
    this.stopPhoneBridge();
    this.cdr.markForCheck();
  }

  setDialogMode(mode: 'catalog' | 'barcode' | 'manual'): void {
    this.dialogMode = mode;
    this.dialogError = '';
    this.dialogSuccess = '';
    this.cdr.markForCheck();
  }

  // ─── Catalog mode ──────────────────────────────────────────────────────────

  onCatalogSearchChange(): void {
    if (!this.catalogSearch) {
      this.catalogFiltered = [];
      this.catalogShowDropdown = false;
      this.catalogSelected = null;
      this.stockWarning = '';
      this.cdr.markForCheck();
      return;
    }
    const search = this.catalogSearch.toLowerCase();
    this.catalogFiltered = this.partsCatalog.filter((p: any) => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const partNumber = (p.part_number || '').toLowerCase();
      return sku.includes(search) || name.includes(search) || partNumber.includes(search);
    }).slice(0, 50);
    this.catalogShowDropdown = this.catalogFiltered.length > 0;
    this.cdr.markForCheck();
  }

  onCatalogSelectPart(part: any): void {
    this.catalogSelected = part;
    this.catalogSearch = `${part.sku} — ${part.name}`;
    this.catalogShowDropdown = false;
    this.catalogPrice = part.unit_cost ?? part.unit_price ?? null;
    this.stockWarning = '';
    const qoh = part.quantity_on_hand ?? Infinity;
    if (isFinite(qoh) && qoh < this.catalogQty) {
      this.stockWarning = `Only ${qoh} in stock at selected location.`;
    }
    this.cdr.markForCheck();
  }

  onCatalogBlur(): void {
    setTimeout(() => {
      this.catalogShowDropdown = false;
      this.cdr.markForCheck();
    }, 200);
  }

  onCatalogQtyChange(): void {
    if (!this.catalogSelected) { return; }
    const qoh = this.catalogSelected.quantity_on_hand ?? Infinity;
    this.stockWarning = isFinite(qoh) && qoh < this.catalogQty
      ? `Only ${qoh} in stock at selected location.`
      : '';
    this.cdr.markForCheck();
  }

  async submitCatalog(override = false): Promise<void> {
    if (!this.catalogSelected) { this.dialogError = 'Select a part from the list.'; return; }
    if (!this.workOrderId) { this.dialogError = 'Save the work order first.'; return; }
    const qoh = this.catalogSelected.quantity_on_hand ?? Infinity;
    if (!override && isFinite(qoh) && qoh < this.catalogQty) {
      this.stockWarning = `Only ${qoh} in stock. Use "Backorder" to proceed anyway.`;
      return;
    }
    this.dialogSubmitting = true;
    this.dialogError = '';
    this.cdr.markForCheck();
    try {
      await lastValueFrom(this.apiService.reserveWorkOrderPart(this.workOrderId, {
        partId: this.catalogSelected.id,
        qtyRequested: this.catalogQty,
        unitPrice: this.catalogPrice ?? this.catalogSelected.unit_cost ?? this.catalogSelected.unit_price ?? 0,
        locationId: this.dialogLocationId || undefined,
        taxable: true
      }));
      this.reloadWorkOrder.emit();
      this.closeAddPartDialog();
    } catch (err: any) {
      this.dialogError = err?.error?.error || err?.message || 'Failed to add part.';
    } finally {
      this.dialogSubmitting = false;
      this.cdr.markForCheck();
    }
  }

  // ─── Barcode mode ──────────────────────────────────────────────────────────

  onBarcodeKeyEnter(event: Event): void {
    event.preventDefault();
    const code = this.dialogBarcodeInput.trim();
    if (code) { this.submitBarcode(code); }
  }

  async submitBarcode(code: string): Promise<void> {
    const normalized = code.trim();
    if (!normalized) { return; }
    if (!this.workOrderId) {
      this.dialogError = 'Save the work order first.';
      this.cdr.markForCheck();
      return;
    }
    this.dialogBarcodeProcessing = true;
    this.dialogError = '';
    this.cdr.markForCheck();
    try {
      const response = await lastValueFrom(
        this.apiService.lookupBarcode(normalized, this.dialogLocationId || undefined)
      );
      const payload = response?.data || response;
      const part = payload?.part || {};
      if (!part?.id) { throw new Error('Barcode not linked to a part'); }
      const packQty = Number(payload?.barcode?.pack_qty) || 1;
      await lastValueFrom(this.apiService.reserveWorkOrderPart(this.workOrderId, {
        partId: part.id,
        qtyRequested: packQty,
        unitPrice: part.unit_price ?? part.unit_cost ?? 0,
        locationId: this.dialogLocationId || undefined,
        taxable: true
      }));
      this.dialogBarcodeInput = '';
      this.dialogSuccess = `Added: ${part.sku || normalized}`;
      this.reloadWorkOrder.emit();
    } catch (err: any) {
      this.dialogError = err?.error?.error || err?.message || `Barcode lookup failed: ${normalized}`;
    } finally {
      this.dialogBarcodeProcessing = false;
      this.cdr.markForCheck();
    }
  }

  // ─── Manual mode ───────────────────────────────────────────────────────────

  async submitManual(): Promise<void> {
    if (!this.manualName.trim()) { this.dialogError = 'Part name is required.'; return; }

    // Try to match by SKU in catalog if workOrderId is available
    if (this.workOrderId) {
      const match = this.manualSku
        ? this.partsCatalog.find((p: any) => (p.sku || '').toLowerCase() === this.manualSku.toLowerCase())
        : null;
      if (match) {
        this.dialogSubmitting = true;
        this.dialogError = '';
        this.cdr.markForCheck();
        try {
          await lastValueFrom(this.apiService.reserveWorkOrderPart(this.workOrderId, {
            partId: match.id,
            qtyRequested: this.manualQty,
            unitPrice: this.manualPrice,
            locationId: this.dialogLocationId || undefined,
            taxable: true
          }));
          this.reloadWorkOrder.emit();
          this.closeAddPartDialog();
          return;
        } catch (err: any) {
          this.dialogError = err?.error?.error || err?.message || 'Failed to reserve part.';
          this.dialogSubmitting = false;
          this.cdr.markForCheck();
          return;
        }
      }
    }

    // No workOrderId or no catalog match — push to inline form array
    if (!this.workOrder.parts) { this.workOrder.parts = []; }
    this.workOrder.parts.push({
      partName: this.manualName.trim(),
      partNumber: this.manualSku.trim(),
      quantity: this.manualQty,
      unitCost: this.manualPrice,
      totalCost: this.manualQty * this.manualPrice
    });
    this.closeAddPartDialog();
  }

  // ─── Inline row actions ────────────────────────────────────────────────────

  issuePart(line: any): void {
    if (!this.workOrderId || !line?.id) { return; }
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            if (part?.quantity_on_hand > 0) { line.status = 'PENDING'; }
            this.proceedWithIssuePart(line);
          } catch { this.proceedWithIssuePart(line); }
        },
        error: () => { this.proceedWithIssuePart(line); }
      });
    } else {
      this.proceedWithIssuePart(line);
    }
  }

  proceedWithIssuePart(line: any): void {
    if (!this.workOrderId) { return; }
    const reserved = Number(line.qty_reserved) || 0;
    const alreadyIssued = Number(line.qty_issued) || 0;
    const maxCanIssue = Math.max(0, reserved - alreadyIssued);
    if (maxCanIssue <= 0) { alert('No remaining reserved quantity to issue for this part'); return; }
    const qtyStr = prompt(`Qty to issue (max: ${maxCanIssue}):`, maxCanIssue.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) { return; }
    if (qty > maxCanIssue) { alert(`Cannot issue more than ${maxCanIssue}.`); return; }
    this.apiService.issueWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => { this.reloadWorkOrder.emit(); }
    });
  }

  returnPart(line: any): void {
    if (!this.workOrderId || !line?.id) { return; }
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            if (part?.quantity_on_hand > 0) { line.status = 'PENDING'; }
            this.proceedWithReturnPart(line);
          } catch { this.proceedWithReturnPart(line); }
        },
        error: () => { this.proceedWithReturnPart(line); }
      });
    } else {
      this.proceedWithReturnPart(line);
    }
  }

  proceedWithReturnPart(line: any): void {
    if (!this.workOrderId) { return; }
    const issued = Number(line.qty_issued) || 0;
    if (issued <= 0) { alert('No issued quantity to return for this part'); return; }
    const qtyStr = prompt(`Qty to return (max: ${issued}):`, issued.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) { return; }
    if (qty > issued) { alert(`Cannot return more than ${issued}.`); return; }
    this.apiService.returnWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => { this.reloadWorkOrder.emit(); }
    });
  }

  reserveFromLine(line: any): void {
    if (!this.workOrderId || !line?.part_id) { return; }
    const requested = Number(line.qty_requested) || 0;
    const reserved = Number(line.qty_reserved) || 0;
    const remainingToReserve = Math.max(0, requested - reserved);
    if (remainingToReserve <= 0) { alert('No remaining quantity to reserve for this part'); return; }
    const qtyStr = prompt(`Qty to reserve (max: ${remainingToReserve}):`, remainingToReserve.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) { return; }
    if (qty > remainingToReserve) { alert(`Cannot reserve more than ${remainingToReserve}.`); return; }
    this.apiService.reserveWorkOrderPart(this.workOrderId, {
      partId: line.part_id, partLineId: line.id, qtyRequested: qty,
      unitPrice: line.unit_price, locationId: line.location_id || this.workOrder?.shopLocationId
    }).subscribe({
      next: () => { this.reloadWorkOrder.emit(); },
      error: (err: any) => { alert(err?.error?.error || err?.message || 'Failed to reserve part'); }
    });
  }

  /** Remove an API-backed part line. NOTE: removeWorkOrderPart API not yet available. */
  removeLine(_line: any): void {
    alert('Remove via API is not yet available for inventory-tracked parts. Contact your administrator to cancel this reservation.');
  }

  /** Remove a form-backed inline part (before WO is saved). */
  removeFormPart(index: number): void {
    this.workOrder.parts.splice(index, 1);
  }

  // ─── Bulk actions ──────────────────────────────────────────────────────────

  async issueAllReserved(): Promise<void> {
    if (!this.workOrderId) { return; }
    const reservedLines = (this.workOrderParts || []).filter((l: any) =>
      ((Number(l.qty_reserved) || 0) - (Number(l.qty_issued) || 0)) > 0
    );
    if (!reservedLines.length) { return; }
    this.bulkActioning = true;
    this.bulkError = '';
    this.cdr.markForCheck();
    try {
      for (const line of reservedLines) {
        const maxCanIssue = (Number(line.qty_reserved) || 0) - (Number(line.qty_issued) || 0);
        if (maxCanIssue <= 0) { continue; }
        try {
          await lastValueFrom(this.apiService.issueWorkOrderPart(this.workOrderId, line.id, maxCanIssue));
        } catch (err: any) {
          this.bulkError = err?.error?.error || err?.message || `Failed to issue ${line.part_name || line.id}`;
        }
      }
      this.reloadWorkOrder.emit();
    } finally {
      this.bulkActioning = false;
      this.cdr.markForCheck();
    }
  }

  async returnAllIssued(): Promise<void> {
    if (!this.workOrderId) { return; }
    const issuedLines = (this.workOrderParts || []).filter((l: any) => (Number(l.qty_issued) || 0) > 0);
    if (!issuedLines.length) { return; }
    this.bulkActioning = true;
    this.bulkError = '';
    this.cdr.markForCheck();
    try {
      for (const line of issuedLines) {
        const qty = Number(line.qty_issued) || 0;
        if (qty <= 0) { continue; }
        try {
          await lastValueFrom(this.apiService.returnWorkOrderPart(this.workOrderId, line.id, qty));
        } catch (err: any) {
          this.bulkError = err?.error?.error || err?.message || `Failed to return ${line.part_name || line.id}`;
        }
      }
      this.reloadWorkOrder.emit();
    } finally {
      this.bulkActioning = false;
      this.cdr.markForCheck();
    }
  }

  // ─── Status badge ──────────────────────────────────────────────────────────

  getStatusBadgeClass(status: string): string {
    switch ((status || '').toUpperCase()) {
      case 'RESERVED':    return 'status-badge status-reserved';
      case 'ISSUED':      return 'status-badge status-issued';
      case 'BACKORDERED': return 'status-badge status-backordered';
      case 'RETURNED':    return 'status-badge status-returned';
      case 'PENDING':     return 'status-badge status-pending';
      default:            return 'status-badge status-pending';
    }
  }

  // ─── Phone bridge ──────────────────────────────────────────────────────────

  startPhoneBridge(): void {
    this.bridgeError = '';
    this.stopPhoneBridge();
    this.apiService.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.bridgeMobileUrl = data.mobileUrl || '';
        this.bridgeSessionId = data.sessionId || '';
        this.qrCodeDataUrl = '';
        if (this.bridgeMobileUrl) {
          QRCode.toDataURL(this.bridgeMobileUrl, { width: 250, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
            .then((url: string) => { this.qrCodeDataUrl = url; this.cdr.markForCheck(); })
            .catch(() => {
              this.qrCodeDataUrl = this.fallbackQrUrl(this.bridgeMobileUrl);
              this.bridgeError = 'Failed to generate QR code locally; using fallback.';
              this.cdr.markForCheck();
            });
        }
        const base = this.apiService.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.bridgeEvents = new EventSource(eventsUrl);
        this.bridgeEvents.addEventListener('ready', () => { this.bridgeConnected = true; this.cdr.markForCheck(); });
        this.bridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const barcode = (payload.barcode || '').toString().trim();
            // Scan event auto-adds directly to work order — no staging table
            if (barcode) { this.submitBarcode(barcode); }
          } catch { /* ignore parse errors */ }
        });
        this.bridgeEvents.onerror = () => {
          this.bridgeConnected = false;
          this.bridgeError = 'Phone scanner disconnected';
          this.cdr.markForCheck();
        };
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.bridgeError = err?.error?.error || err?.message || 'Failed to start phone bridge';
        this.cdr.markForCheck();
      }
    });
  }

  stopPhoneBridge(): void {
    if (this.bridgeEvents) { this.bridgeEvents.close(); this.bridgeEvents = null; }
    this.bridgeConnected = false;
    this.bridgeMobileUrl = '';
    this.bridgeSessionId = '';
    this.qrCodeDataUrl = '';
  }

  // ─── Labor table ───────────────────────────────────────────────────────────

  addLabor(): void {
    if (!this.workOrder.labor) { this.workOrder.labor = []; }
    this.workOrder.labor.push({});
    this.updateAssignedToFromLabor();
  }

  removeLabor(index: number): void {
    this.workOrder.labor.splice(index, 1);
    this.updateAssignedToFromLabor();
  }

  onMechanicLookup(index: number, lookupValue: string): void {
    if (!lookupValue) { return; }
    const normalized = lookupValue.trim().toLowerCase();
    const tech = this.technicians.find((t: any) => (t.username || '').toLowerCase() === normalized);
    if (!tech) { return; }
    const labor = this.workOrder.labor[index] || {};
    labor.mechanicId = tech.id;
    labor.mechanicName = tech.username;
    this.workOrder.labor[index] = labor;
    this.updateAssignedToFromLabor();
  }

  filterTechnicians(query: string | null | undefined): any[] {
    if (!query) { return this.technicians; }
    const normalized = query.trim().toLowerCase();
    return this.technicians.filter((t: any) => (t.username || '').toLowerCase().includes(normalized));
  }

  showTechnicianDropdown(index: number, show: boolean): void {
    if (show) { this.activeMechanicIndex = index; }
    else if (this.activeMechanicIndex === index) { this.activeMechanicIndex = null; }
  }

  selectTechnician(index: number, tech: any): void {
    const labor = this.workOrder.labor[index] || {};
    labor.mechanicId = tech.id;
    labor.mechanicName = tech.username;
    this.workOrder.labor[index] = labor;
    this.activeMechanicIndex = null;
    this.updateAssignedToFromLabor();
  }

  updateLaborTotals(index: number): void {
    const labor = this.workOrder.labor[index];
    if (!labor) { return; }
    const hours = Number(labor.hours) || 0;
    const rate = Number(labor.rate) || 0;
    labor.cost = hours * rate;
    this.workOrder.labor[index] = labor;
  }

  updateAssignedToFromLabor(): void {
    const names = (this.workOrder.labor || [])
      .map((line: any) => (line?.mechanicName || '').trim())
      .filter((name: string) => name.length > 0);
    this.workOrder.assignedTo = Array.from(new Set(names)).join(', ');
  }

  // ─── Display helpers ───────────────────────────────────────────────────────

  resolveBinDisplay(inventoryItem: any): string {
    if (inventoryItem?.bin) {
      const code = inventoryItem.bin.bin_code || '';
      const name = inventoryItem.bin.bin_name || '';
      return name ? `${code} (${name})` : code;
    }
    if (inventoryItem?.bin_code) {
      const name = inventoryItem.bin_name || '';
      return name ? `${inventoryItem.bin_code} (${name})` : inventoryItem.bin_code;
    }
    if (inventoryItem?.bin_location) { return inventoryItem.bin_location; }
    return '';
  }

  get hasReservedLines(): boolean {
    return (this.workOrderParts || []).some((l: any) =>
      ((Number(l.qty_reserved) || 0) - (Number(l.qty_issued) || 0)) > 0
    );
  }

  get hasIssuedLines(): boolean {
    return (this.workOrderParts || []).some((l: any) => (Number(l.qty_issued) || 0) > 0);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private fallbackQrUrl(data: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data || '')}`;
  }
}
