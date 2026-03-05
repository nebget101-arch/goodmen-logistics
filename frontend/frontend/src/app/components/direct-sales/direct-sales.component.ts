import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-direct-sales',
  templateUrl: './direct-sales.component.html',
  styleUrls: ['./direct-sales.component.css']
})
export class DirectSalesComponent implements OnInit, AfterViewInit {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  locations: any[] = [];
  customers: any[] = [];

  locationId = '';
  customerId = '';
  taxRatePercent = 8.25;

  scanCode = '';
  lines: Array<{ partId: string; sku: string; name: string; qty: number; unitPrice: number }> = [];

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
        if (!this.locationId && this.locations.length > 0) this.locationId = this.locations[0].id;
      }
    });

    this.api.getCustomers({ pageSize: 500 }).subscribe({
      next: (res: any) => this.customers = res?.data || []
    });
  }

  ngAfterViewInit(): void {
    this.focusScan();
  }

  focusScan(): void {
    setTimeout(() => this.scanInput?.nativeElement.focus(), 0);
  }

  addScan(): void {
    this.clearMessages();
    const code = this.scanCode.trim();
    if (!code) return;
    if (!this.locationId) {
      this.error = 'Select location';
      return;
    }

    this.api.lookupBarcode(code, this.locationId).subscribe({
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
        else this.lines.unshift({
          partId: part.id,
          sku: part.sku,
          name: part.name,
          qty,
          unitPrice: Number(part.default_retail_price || 0)
        });

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
            this.addScan();
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

  removeLine(index: number): void {
    this.lines.splice(index, 1);
  }

  submitSale(): void {
    this.clearMessages();
    if (!this.customerId || !this.locationId || this.lines.length === 0) {
      this.error = 'Customer, location, and at least one line are required';
      return;
    }

    this.submitting = true;
    this.api.createDirectSale({
      customerId: this.customerId,
      locationId: this.locationId,
      taxRatePercent: this.taxRatePercent,
      notes: 'Direct customer sale from web admin',
      items: this.lines.map(l => ({
        partId: l.partId,
        qty: l.qty,
        unitPrice: l.unitPrice
      }))
    }).subscribe({
      next: (res: any) => {
        const invoiceNo = res?.data?.invoice?.invoice_number;
        this.message = `Sale completed${invoiceNo ? `, invoice ${invoiceNo}` : ''}`;
        this.lines = [];
        this.submitting = false;
        this.focusScan();
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Sale failed';
        this.submitting = false;
      }
    });
  }

  get total(): number {
    return this.lines.reduce((sum, l) => sum + (Number(l.unitPrice) * Number(l.qty)), 0);
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
