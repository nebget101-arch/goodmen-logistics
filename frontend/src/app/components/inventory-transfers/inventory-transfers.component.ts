import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-inventory-transfers',
  templateUrl: './inventory-transfers.component.html',
  styleUrls: ['./inventory-transfers.component.css']
})
export class InventoryTransfersComponent implements OnInit, AfterViewInit {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;
  @ViewChild('decodeFileInput') decodeFileInput?: ElementRef<HTMLInputElement>;

  locations: any[] = [];
  fromLocationId = '';
  toLocationId = '';
  scanCode = '';

  lines: Array<{ partId: string; sku: string; name: string; qty: number }> = [];

  receiveTransferId = '';

  message = '';
  error = '';
  submitting = false;

  // ── FN-710: Supply-rule destination filtering ────────────────────────────────

  /** When true, all locations are shown in the destination dropdown regardless of rules. */
  showAllDestinations = false;

  /** Supply rules loaded for the selected source (WAREHOUSE) location. */
  supplyRules: any[] = [];
  loadingSupplyRules = false;

  /** Low-stock items at the destination shop, populated when auto_replenish rule exists. */
  suggestedItems: Array<{
    partId: string; sku: string; name: string;
    on_hand_qty: number; reorder_level: number; suggestedQty: number;
  }> = [];
  loadingSuggestions = false;
  showSuggestedPanel = false;
  // ─────────────────────────────────────────────────────────────────────────────

  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  qrCodeDataUrl = '';
  private bridgeEvents?: EventSource;
  readonly perms = PERMISSIONS;

  constructor(
    private api: ApiService,
    private readonly permissionHelper: PermissionHelperService
  ) {}

  canCreateTransfer(): boolean {
    return this.permissionHelper.hasPermission(this.perms.INVENTORY_TRANSFER);
  }

  canReceiveTransfer(): boolean {
    return this.permissionHelper.hasAnyPermission([
      this.perms.INVENTORY_ADJUST,
      this.perms.INVENTORY_TRANSFER,
    ]);
  }

  ngOnInit(): void {
    this.api.getLocations().subscribe({
      next: (res: any) => {
        this.locations = res?.data || res || [];
        if (this.locations.length > 1) {
          this.fromLocationId = this.locations[0].id;
          this.toLocationId = this.locations[1].id;
        }
      }
    });
  }

  ngAfterViewInit(): void {
    this.focusScan();
  }

  focusScan(): void {
    setTimeout(() => this.scanInput?.nativeElement.focus(), 0);
  }

  addByScan(): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to add transfer lines.';
      return;
    }
    this.clearMessages();
    const code = this.scanCode.trim();
    if (!code) return;
    if (!this.fromLocationId) {
      this.error = 'Select source location';
      return;
    }

    this.api.lookupBarcode(code, this.fromLocationId).subscribe({
      next: (res: any) => {
        const part = res?.data?.part;
        const barcode = res?.data?.barcode;
        if (!part || !barcode) {
          this.error = 'Barcode lookup failed';
          return;
        }

        const qty = Number(barcode.pack_qty || 1);
        const existing = this.lines.find(l => l.partId === part.id);
        if (existing) existing.qty += qty;
        else this.lines.unshift({ partId: part.id, sku: part.sku, name: part.name, qty });

        this.scanCode = '';
        this.message = `Added ${part.sku} x${qty}`;
        this.focusScan();
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Barcode not found';
        this.focusScan();
      }
    });
  }

  startPhoneBridge(): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to create transfers.';
      return;
    }
    this.clearMessages();
    this.stopPhoneBridge();
    this.api.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.bridgeMobileUrl = data.mobileUrl || '';
        this.bridgeSessionId = data.sessionId || '';
        this.qrCodeDataUrl = '';
        if (this.bridgeMobileUrl) {
          QRCode.toDataURL(this.bridgeMobileUrl, {
            width: 250,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          }).then((url: string) => {
            this.qrCodeDataUrl = url;
          }).catch(() => {
            this.qrCodeDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(this.bridgeMobileUrl)}`;
          });
        }
        const base = this.api.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.bridgeEvents = new EventSource(eventsUrl);
        this.bridgeEvents.addEventListener('ready', () => {
          this.bridgeConnected = true;
          this.message = 'Phone scanner connected';
        });
        this.bridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const barcode = (payload.barcode || '').toString().trim();
            if (!barcode) return;
            this.scanCode = barcode;
            this.addByScan();
          } catch {}
        });
        this.bridgeEvents.onerror = () => {
          this.bridgeConnected = false;
          this.error = 'Phone scanner disconnected';
        };
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to start phone bridge';
      }
    });
  }

  stopPhoneBridge(): void {
    if (this.bridgeEvents) {
      this.bridgeEvents.close();
      this.bridgeEvents = undefined;
    }
    this.bridgeConnected = false;
    this.bridgeMobileUrl = '';
    this.bridgeSessionId = '';
    this.qrCodeDataUrl = '';
  }

  openPhoneBridge(): void {
    if (this.bridgeMobileUrl) window.open(this.bridgeMobileUrl, '_blank');
  }

  triggerDecodeImage(): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to add transfer lines.';
      return;
    }
    this.decodeFileInput?.nativeElement?.click();
  }

  onDecodeImage(event: Event): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to add transfer lines.';
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.clearMessages();
    this.api.decodeBarcodeFromImage(file).subscribe({
      next: (res: any) => {
        const barcode = res?.data?.barcode;
        if (barcode) {
          this.scanCode = barcode;
          this.addByScan();
        } else {
          this.error = 'No barcode found in image';
        }
        input.value = '';
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to decode barcode from image';
        input.value = '';
      }
    });
  }

  createTransfer(): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to create transfers.';
      return;
    }
    this.clearMessages();
    if (!this.fromLocationId || !this.toLocationId) {
      this.error = 'Select source and destination locations';
      return;
    }
    if (this.fromLocationId === this.toLocationId) {
      this.error = 'Source and destination cannot be the same';
      return;
    }
    if (this.lines.length === 0) {
      this.error = 'Add at least one line';
      return;
    }

    this.submitting = true;
    this.api.createTransfer({
      fromLocationId: this.fromLocationId,
      toLocationId: this.toLocationId,
      lines: this.lines.map(l => ({ partId: l.partId, qty: l.qty })),
      notes: 'Transfer created from web admin'
    }).subscribe({
      next: (res: any) => {
        const tr = res?.data?.transfer;
        this.message = `Transfer created: ${tr?.transfer_number || tr?.id}`;
        this.receiveTransferId = tr?.id || '';
        this.lines = [];
        this.submitting = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Transfer create failed';
        this.submitting = false;
      }
    });
  }

  receiveTransfer(): void {
    if (!this.canReceiveTransfer()) {
      this.error = 'You do not have permission to receive transfers.';
      return;
    }
    this.clearMessages();
    if (!this.receiveTransferId.trim()) {
      this.error = 'Transfer ID is required';
      return;
    }

    this.api.receiveTransfer(this.receiveTransferId.trim(), { notes: 'Received from web admin' }).subscribe({
      next: () => this.message = 'Transfer received successfully',
      error: (err: any) => this.error = err?.error?.error || err?.message || 'Transfer receive failed'
    });
  }

  removeLine(index: number): void {
    if (!this.canCreateTransfer()) {
      this.error = 'You do not have permission to modify transfer lines.';
      return;
    }
    this.lines.splice(index, 1);
  }

  // ── FN-710: Supply rule getters ───────────────────────────────────────────

  /** The full location object for the selected source. */
  get fromLocation(): any {
    return this.locations.find(l => l.id === this.fromLocationId) ?? null;
  }

  /** True when the source location is of type WAREHOUSE. */
  get isFromWarehouse(): boolean {
    return (this.fromLocation?.location_type ?? '').toUpperCase() === 'WAREHOUSE';
  }

  /** Set of shop location IDs covered by active supply rules from this warehouse. */
  get suppliedShopIds(): Set<string> {
    return new Set(
      this.supplyRules
        .filter(r => r.active !== false)
        .map(r => r.shop_location_id)
    );
  }

  /**
   * Destination list shown in the "To" dropdown.
   * Filtered to supply-rule shops when source is WAREHOUSE and toggle is off.
   */
  get filteredDestinations(): any[] {
    if (!this.isFromWarehouse || this.showAllDestinations) return this.locations;
    if (!this.supplyRules.length) return this.locations; // rules not yet loaded
    return this.locations.filter(l => this.suppliedShopIds.has(l.id));
  }

  /** Active supply rule between current source warehouse and selected destination. */
  get activeSupplyRule(): any | null {
    if (!this.isFromWarehouse || !this.toLocationId) return null;
    return this.supplyRules.find(
      r => r.shop_location_id === this.toLocationId && r.active !== false
    ) ?? null;
  }

  // ── FN-710: Source / destination change handlers ──────────────────────────

  onFromLocationChange(): void {
    this.supplyRules         = [];
    this.suggestedItems      = [];
    this.showSuggestedPanel  = false;
    this.toLocationId        = '';
    this.clearMessages();

    if (this.isFromWarehouse && this.fromLocationId) {
      this.loadSupplyRules();
    }
  }

  private loadSupplyRules(): void {
    this.loadingSupplyRules = true;
    this.api.getLocationSupplyRules(this.fromLocationId).subscribe({
      next: (res: any) => {
        this.supplyRules        = res?.data || (Array.isArray(res) ? res : []);
        this.loadingSupplyRules = false;
      },
      error: () => {
        this.loadingSupplyRules = false;
      }
    });
  }

  onToLocationChange(): void {
    this.suggestedItems     = [];
    this.showSuggestedPanel = false;
    this.clearMessages();

    if (this.activeSupplyRule?.auto_replenish && this.toLocationId) {
      this.loadSuggestions();
    }
  }

  private loadSuggestions(): void {
    this.loadingSuggestions = true;
    this.api.getInventory(this.toLocationId).subscribe({
      next: (res: any) => {
        const items: any[] = res?.data || [];
        this.suggestedItems = items
          .filter((item: any) => {
            const onHand  = Number(item.on_hand_qty  ?? 0);
            const reorder = Number(item.reorder_level ?? item.min_stock_level ?? 0);
            return reorder > 0 && onHand < reorder;
          })
          .map((item: any) => {
            const onHand  = Number(item.on_hand_qty  ?? 0);
            const reorder = Number(item.reorder_level ?? item.min_stock_level ?? 0);
            return {
              partId:       item.part_id || item.id,
              sku:          item.sku          || '',
              name:         item.name         || item.part_name || '',
              on_hand_qty:  onHand,
              reorder_level: reorder,
              suggestedQty: Math.max(1, reorder - onHand)
            };
          });
        this.showSuggestedPanel = this.suggestedItems.length > 0;
        this.loadingSuggestions = false;
      },
      error: () => {
        this.loadingSuggestions = false;
      }
    });
  }

  // ── FN-710: Add suggested lines ───────────────────────────────────────────

  addSuggestedLine(item: { partId: string; sku: string; name: string; suggestedQty: number }): void {
    const existing = this.lines.find(l => l.partId === item.partId);
    if (existing) {
      existing.qty += item.suggestedQty;
    } else {
      this.lines.unshift({ partId: item.partId, sku: item.sku, name: item.name, qty: item.suggestedQty });
    }
    this.message = `Added ${item.sku} ×${item.suggestedQty}`;
  }

  addAllSuggested(): void {
    this.suggestedItems.forEach(item => this.addSuggestedLine(item));
    this.message = `Added ${this.suggestedItems.length} suggested line(s)`;
  }

  getLocationName(id: string): string {
    return this.locations.find(l => l.id === id)?.name ?? 'destination';
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
