import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-inventory-transfers',
  templateUrl: './inventory-transfers.component.html',
  styleUrls: ['./inventory-transfers.component.css']
})
export class InventoryTransfersComponent implements OnInit, AfterViewInit {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  locations: any[] = [];
  fromLocationId = '';
  toLocationId = '';
  scanCode = '';

  lines: Array<{ partId: string; sku: string; name: string; qty: number }> = [];

  receiveTransferId = '';

  message = '';
  error = '';
  submitting = false;
  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  showBridgeQr = false;
  private bridgeEvents?: EventSource;

  get bridgeQrUrl(): string {
    if (!this.bridgeMobileUrl) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(this.bridgeMobileUrl)}`;
  }

  constructor(private api: ApiService) {}

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
    this.clearMessages();
    this.stopPhoneBridge();
    this.api.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.bridgeMobileUrl = data.mobileUrl || '';
        this.bridgeSessionId = data.sessionId || '';
        const base = this.api.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.bridgeEvents = new EventSource(eventsUrl);
        this.bridgeEvents.addEventListener('ready', () => { this.bridgeConnected = true; });
        this.bridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const barcode = (payload.barcode || '').toString().trim();
            if (!barcode) return;
            this.scanCode = barcode;
            this.addByScan();
          } catch {}
        });
        this.bridgeEvents.onerror = () => { this.bridgeConnected = false; };
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to start phone bridge';
      }
    });
  }

  openPhoneBridge(): void {
    if (!this.bridgeMobileUrl) return;
    window.open(this.bridgeMobileUrl, '_blank');
  }

  stopPhoneBridge(): void {
    if (this.bridgeEvents) {
      this.bridgeEvents.close();
      this.bridgeEvents = undefined;
    }
    this.bridgeConnected = false;
    this.bridgeMobileUrl = '';
    this.bridgeSessionId = '';
    this.showBridgeQr = false;
  }

  createTransfer(): void {
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
    this.lines.splice(index, 1);
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
