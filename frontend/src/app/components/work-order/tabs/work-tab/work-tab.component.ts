import { Component, Input, Output, EventEmitter, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
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

  /* Part search */
  filteredParts: any[] = [];
  partSearch = '';
  showPartDropdown = false;

  /* Reserve part form */
  reservePartForm: any = { partId: '', qtyRequested: 1, unitPrice: null, locationId: '' };

  /* Scanner */
  scanBatchInput = '';
  scanBatchProcessing = false;
  scanBatchErrors: string[] = [];
  scanBatchSuccess = '';
  scannedParts: Array<{
    partId: string; sku: string; name: string; qty: number;
    unitPrice: number; packQty: number; barcodeValue?: string;
  }> = [];
  scanCache: Record<string, any> = {};

  /* Phone bridge */
  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  bridgeEvents: EventSource | null = null;
  qrCodeDataUrl = '';
  scanBridgeError = '';

  /* Technician dropdown */
  activeMechanicIndex: number | null = null;

  constructor(private apiService: ApiService) {}

  ngOnDestroy(): void {
    this.stopPhoneBridge();
  }

  /* ─── Parts table ─── */

  addPart(): void {
    this.workOrder.parts.push({});
  }

  removePart(index: number): void {
    this.workOrder.parts.splice(index, 1);
  }

  onPartLookup(index: number, lookupValue: string): void {
    const selected = this.findPartByLookup(lookupValue);
    if (!selected) return;
    const part = this.workOrder.parts[index] || {};
    part.partId = selected.id;
    part.partName = selected.name;
    part.partNumber = selected.sku;
    part.quantity = part.quantity ?? 1;
    part.unitCost = selected.unit_cost ?? selected.unit_price ?? part.unitCost;
    part.binDisplay = this.resolveBinDisplay(selected);
    this.updatePartTotals(index);
    this.workOrder.parts[index] = part;
  }

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
    if (inventoryItem?.bin_location) return inventoryItem.bin_location;
    return '';
  }

  updatePartTotals(index: number): void {
    const part = this.workOrder.parts[index];
    if (!part) return;
    const qty = Number(part.quantity) || 0;
    const unitCost = Number(part.unitCost) || 0;
    part.totalCost = qty * unitCost;
    this.workOrder.parts[index] = part;
  }

  /* ─── Part search dropdown ─── */

  onPartSearchChange(): void {
    if (!this.partSearch) {
      this.filteredParts = [];
      this.showPartDropdown = false;
      return;
    }
    const search = this.partSearch.toLowerCase();
    this.filteredParts = this.partsCatalog.filter((p: any) => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const partNumber = (p.part_number || '').toLowerCase();
      return sku.includes(search) || name.includes(search) || partNumber.includes(search);
    }).slice(0, 50);
    this.showPartDropdown = this.filteredParts.length > 0;
  }

  selectPart(part: any): void {
    this.reservePartForm.partId = part.id;
    this.partSearch = `${part.sku} - ${part.name}`;
    this.showPartDropdown = false;
    this.onReservePartChange();
  }

  onPartBlur(): void {
    setTimeout(() => { this.showPartDropdown = false; }, 200);
  }

  onPartHover(event: any, isEnter: boolean): void {
    const element = event?.target as HTMLElement;
    if (element) {
      element.style.backgroundColor = isEnter ? 'rgba(59,130,246,0.15)' : 'transparent';
    }
  }

  onReservePartChange(): void {
    const selected = this.partsCatalog.find((p: any) => String(p.id) === String(this.reservePartForm.partId));
    if (!selected) return;
    if (this.reservePartForm.unitPrice === null || this.reservePartForm.unitPrice === undefined || this.reservePartForm.unitPrice === '') {
      this.reservePartForm.unitPrice = selected.unit_cost ?? selected.unit_price ?? this.reservePartForm.unitPrice;
    }
  }

  reservePart(): void {
    if (!this.workOrderId) return;
    const payload = {
      partId: this.reservePartForm.partId,
      qtyRequested: this.reservePartForm.qtyRequested,
      unitPrice: this.reservePartForm.unitPrice,
      locationId: this.reservePartForm.locationId || this.workOrder.shopLocationId,
      taxable: true
    };
    this.apiService.reserveWorkOrderPart(this.workOrderId, payload).subscribe({
      next: () => {
        const selected = this.partsCatalog.find((p: any) => String(p.id) === String(this.reservePartForm.partId));
        if (selected) {
          const qty = Number(this.reservePartForm.qtyRequested) || 1;
          const unitCost = Number(this.reservePartForm.unitPrice ?? selected.unit_cost ?? selected.unit_price ?? 0);
          this.workOrder.parts.push({
            partId: selected.id, partName: selected.name, partNumber: selected.sku,
            quantity: qty, unitCost, totalCost: qty * unitCost
          });
        }
        this.reservePartForm = { partId: '', qtyRequested: 1, unitPrice: null, locationId: this.workOrder.shopLocationId || '' };
        this.partSearch = '';
        this.reloadWorkOrder.emit();
      }
    });
  }

  /* ─── Inventory parts actions ─── */

  issuePart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            if (part && part.quantity_on_hand && part.quantity_on_hand > 0) {
              line.status = 'PENDING';
            }
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
    if (!this.workOrderId) return;
    const reserved = Number(line.qty_reserved) || 0;
    const alreadyIssued = Number(line.qty_issued) || 0;
    const maxCanIssue = Math.max(0, reserved - alreadyIssued);
    if (maxCanIssue <= 0) { alert('No remaining reserved quantity to issue for this part'); return; }
    const qtyStr = prompt(`Qty to issue (max: ${maxCanIssue}):`, maxCanIssue.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    if (qty > maxCanIssue) { alert(`Cannot issue more than ${maxCanIssue}.`); return; }
    this.apiService.issueWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => { this.reloadWorkOrder.emit(); }
    });
  }

  returnPart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            if (part && part.quantity_on_hand && part.quantity_on_hand > 0) {
              line.status = 'PENDING';
            }
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
    if (!this.workOrderId) return;
    const issued = Number(line.qty_issued) || 0;
    if (issued <= 0) { alert('No issued quantity to return for this part'); return; }
    const qtyStr = prompt(`Qty to return (max: ${issued}):`, issued.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    if (qty > issued) { alert(`Cannot return more than ${issued}.`); return; }
    this.apiService.returnWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => { this.reloadWorkOrder.emit(); }
    });
  }

  reserveFromLine(line: any): void {
    if (!this.workOrderId || !line?.part_id) return;
    const requested = Number(line.qty_requested) || 0;
    const reserved = Number(line.qty_reserved) || 0;
    const remainingToReserve = Math.max(0, requested - reserved);
    if (remainingToReserve <= 0) { alert('No remaining quantity to reserve for this part'); return; }
    const qtyStr = prompt(`Qty to reserve (max: ${remainingToReserve}):`, remainingToReserve.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    if (qty > remainingToReserve) { alert(`Cannot reserve more than ${remainingToReserve}.`); return; }
    const payload = {
      partId: line.part_id, partLineId: line.id, qtyRequested: qty,
      unitPrice: line.unit_price, locationId: line.location_id || this.workOrder?.shopLocationId
    };
    this.apiService.reserveWorkOrderPart(this.workOrderId, payload).subscribe({
      next: () => { this.reloadWorkOrder.emit(); },
      error: (err: any) => { alert(err?.error?.error || err?.message || 'Failed to reserve part'); }
    });
  }

  /* ─── Labor table ─── */

  addLabor(): void {
    this.workOrder.labor.push({});
    this.updateAssignedToFromLabor();
  }

  removeLabor(index: number): void {
    this.workOrder.labor.splice(index, 1);
    this.updateAssignedToFromLabor();
  }

  onMechanicLookup(index: number, lookupValue: string): void {
    if (!lookupValue) return;
    const normalized = lookupValue.trim().toLowerCase();
    const tech = this.technicians.find((t: any) => (t.username || '').toLowerCase() === normalized);
    if (!tech) return;
    const labor = this.workOrder.labor[index] || {};
    labor.mechanicId = tech.id;
    labor.mechanicName = tech.username;
    this.workOrder.labor[index] = labor;
    this.updateAssignedToFromLabor();
  }

  filterTechnicians(query: string | null | undefined): any[] {
    if (!query) return this.technicians;
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
    if (!labor) return;
    const hours = Number(labor.hours) || 0;
    const rate = Number(labor.rate) || 0;
    labor.cost = hours * rate;
    this.workOrder.labor[index] = labor;
  }

  updateAssignedToFromLabor(): void {
    const names = (this.workOrder.labor || [])
      .map((line: any) => (line?.mechanicName || '').trim())
      .filter((name: string) => name.length > 0);
    const unique = Array.from(new Set(names));
    this.workOrder.assignedTo = unique.join(', ');
  }

  /* ─── Barcode scanning ─── */

  async processScannedParts(): Promise<void> {
    if (!this.workOrderId) return;
    this.scanBatchErrors = [];
    this.scanBatchSuccess = '';
    if (!this.scannedParts.length && this.scanBatchInput.trim()) {
      await this.buildScannedPartsFromText();
    }
    if (!this.scannedParts.length) return;

    const locationId = this.reservePartForm.locationId || this.workOrder.shopLocationId || '';
    this.scanBatchProcessing = true;
    try {
      let successCount = 0;
      for (const line of this.scannedParts) {
        if (!line.partId || line.qty <= 0) continue;
        try {
          await lastValueFrom(this.apiService.reserveWorkOrderPart(this.workOrderId, {
            partId: line.partId, qtyRequested: line.qty, unitPrice: line.unitPrice,
            locationId: locationId || undefined, taxable: true
          }));
          successCount += 1;
        } catch (error: any) {
          this.scanBatchErrors.push(`${line.sku || line.partId}: ${error?.error?.error || error?.message || 'Reserve failed'}`);
        }
      }
      if (successCount > 0) {
        this.scanBatchSuccess = `Added ${successCount} part${successCount === 1 ? '' : 's'} from scan.`;
        this.reloadWorkOrder.emit();
      }
    } catch (error: any) {
      this.scanBatchErrors.push(error?.error?.error || error?.message || 'Scan failed');
    } finally {
      this.scanBatchInput = '';
      this.scannedParts = [];
      this.scanBatchProcessing = false;
      this.stopPhoneBridge();
    }
  }

  startPhoneBridge(): void {
    this.scanBridgeError = '';
    this.stopPhoneBridge();
    this.apiService.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.bridgeMobileUrl = data.mobileUrl || '';
        this.bridgeSessionId = data.sessionId || '';
        this.qrCodeDataUrl = '';
        if (this.bridgeMobileUrl) {
          QRCode.toDataURL(this.bridgeMobileUrl, { width: 250, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
            .then((url: string) => { this.qrCodeDataUrl = url; })
            .catch(() => {
              this.qrCodeDataUrl = this.fallbackQrUrl(this.bridgeMobileUrl);
              this.scanBridgeError = 'Failed to generate QR code locally; using fallback.';
            });
        }
        const base = this.apiService.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.bridgeEvents = new EventSource(eventsUrl);
        this.bridgeEvents.addEventListener('ready', () => { this.bridgeConnected = true; });
        this.bridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const barcode = (payload.barcode || '').toString().trim();
            if (barcode) this.appendScanCode(barcode);
          } catch { /* ignore parse errors */ }
        });
        this.bridgeEvents.onerror = () => {
          this.bridgeConnected = false;
          this.scanBridgeError = 'Phone scanner disconnected';
        };
      },
      error: (err: any) => {
        this.scanBridgeError = err?.error?.error || err?.message || 'Failed to start phone bridge';
      }
    });
  }

  stopPhoneBridge(): void {
    if (this.bridgeEvents) {
      this.bridgeEvents.close();
      this.bridgeEvents = null;
    }
    this.bridgeConnected = false;
    this.bridgeMobileUrl = '';
    this.bridgeSessionId = '';
    this.qrCodeDataUrl = '';
  }

  removeScannedPart(index: number): void {
    this.scannedParts.splice(index, 1);
  }

  async reserveSingleScannedPart(line: any): Promise<void> {
    if (!this.workOrderId || !line?.partId) {
      if (!this.workOrderId) this.scanBatchErrors.push('Save the work order before reserving scanned parts.');
      return;
    }
    const locationId = this.reservePartForm.locationId || this.workOrder.shopLocationId || '';
    const qty = Math.max(1, Number(line.qty) || 1);
    line.qty = qty;
    if (qty <= 0) return;
    try {
      this.scanBatchSuccess = 'Reserving...';
      const response = await lastValueFrom(this.apiService.reserveWorkOrderPart(this.workOrderId, {
        partId: line.partId, qtyRequested: qty, unitPrice: Number(line.unitPrice) || 0,
        locationId: locationId || undefined, taxable: true
      }));
      const savedLine = response?.data || response;
      if (savedLine) {
        const existingIndex = (this.workOrderParts || []).findIndex((p: any) => String(p.id) === String(savedLine.id));
        if (existingIndex >= 0) { this.workOrderParts[existingIndex] = savedLine; }
        else { this.workOrderParts.unshift(savedLine); }
      }
      const idx = this.scannedParts.indexOf(line);
      if (idx >= 0) this.removeScannedPart(idx);
      this.scanBatchSuccess = `Reserved ${line.sku || line.partId}.`;
      this.reloadWorkOrder.emit();
    } catch (error: any) {
      this.scanBatchErrors.push(`${line.sku || line.partId}: ${error?.error?.error || error?.message || 'Reserve failed'}`);
    }
  }

  /* ─── Private helpers ─── */

  private findPartByLookup(lookupValue: string): any | null {
    if (!lookupValue) return null;
    const normalized = lookupValue.trim().toLowerCase();
    return this.partsCatalog.find((p: any) => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const combined = `${p.sku || ''} - ${p.name || ''}`.toLowerCase();
      return sku === normalized || name === normalized || combined === normalized;
    }) || null;
  }

  private appendScanCode(code: string): void {
    if (!code) return;
    const existing = this.scanBatchInput ? `${this.scanBatchInput.trim()}\n` : '';
    this.scanBatchInput = `${existing}${code}`.trim();
    this.handleBarcodeScan(code);
  }

  private fallbackQrUrl(data: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data || '')}`;
  }

  private async buildScannedPartsFromText(): Promise<void> {
    const codes = this.extractScanCodes(this.scanBatchInput);
    for (const code of codes) { await this.handleBarcodeScan(code); }
  }

  private async handleBarcodeScan(code: string): Promise<void> {
    const normalized = String(code || '').trim();
    if (!normalized) return;
    const cached = this.scanCache[normalized];
    if (cached?.part) { this.upsertScannedPart(cached.part, cached.barcode, cached.packQty); return; }
    try {
      const locationId = this.reservePartForm.locationId || this.workOrder.shopLocationId || '';
      const response = await lastValueFrom(this.apiService.lookupBarcode(normalized, locationId || undefined));
      const payload = response?.data || response;
      const barcode = payload?.barcode || {};
      const part = payload?.part || {};
      if (!part?.id) throw new Error('Barcode not linked to a part');
      const packQty = Number(barcode.pack_qty) || 1;
      this.scanCache[normalized] = { part, barcode, packQty };
      this.upsertScannedPart(part, barcode, packQty);
    } catch (error: any) {
      this.scanBatchErrors.push(`${normalized}: ${error?.error?.error || error?.message || 'Lookup failed'}`);
    }
  }

  private upsertScannedPart(part: any, barcode: any, _packQty: number): void {
    const existing = this.scannedParts.find(p => p.partId === part.id);
    if (existing) return;
    const unitPrice = Number(part.unit_price ?? part.unit_cost ?? part.default_retail_price ?? part.default_cost ?? 0);
    this.scannedParts.push({
      partId: part.id, sku: part.sku || '', name: part.name || '',
      qty: 1, unitPrice, packQty: 1, barcodeValue: barcode?.barcode_value
    });
  }

  private extractScanCodes(input: string): string[] {
    return (input || '').split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
  }
}
