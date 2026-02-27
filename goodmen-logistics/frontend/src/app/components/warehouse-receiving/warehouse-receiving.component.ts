import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-warehouse-receiving',
  templateUrl: './warehouse-receiving.component.html',
  styleUrls: ['./warehouse-receiving.component.css']
})
export class WarehouseReceivingComponent implements OnInit, AfterViewInit {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  locations: any[] = [];
  locationId = '';
  scanCode = '';
  qtyMultiplier = 1;

  lines: Array<{ partId: string; sku: string; name: string; qty: number; unitCostAtTime?: number }> = [];

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
        if (!this.locationId && this.locations.length > 0) {
          const warehouse = this.locations.find((l: any) => (l.name || '').toUpperCase().includes('WAREHOUSE'));
          this.locationId = (warehouse || this.locations[0]).id;
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

  onScanEnter(): void {
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

        const qty = Number(barcode.pack_qty || 1) * Number(this.qtyMultiplier || 1);
        const existing = this.lines.find(l => l.partId === part.id);
        if (existing) {
          existing.qty += qty;
        } else {
          this.lines.unshift({
            partId: part.id,
            sku: part.sku,
            name: part.name,
            qty,
            unitCostAtTime: part.default_cost || 0
          });
        }

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
            this.onScanEnter();
          } catch {}
        });
        this.bridgeEvents.onerror = () => {
          this.bridgeConnected = false;
        };
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
    this.focusScan();
  }

  postReceive(): void {
    this.clearMessages();
    if (!this.locationId || this.lines.length === 0) {
      this.error = 'Location and at least one line are required';
      return;
    }

    this.submitting = true;
    const payloads = this.lines.map(line =>
      firstValueFrom(this.api.receiveInventory({
        locationId: this.locationId,
        partId: line.partId,
        qty: line.qty,
        unitCostAtTime: line.unitCostAtTime,
        referenceType: 'RECEIVING_TICKET',
        referenceId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `recv-${Date.now()}`,
        notes: 'Warehouse receive via scanner'
      }))
    );

    Promise.all(payloads)
      .then(() => {
        this.message = `Received ${this.lines.length} line(s)`;
        this.lines = [];
      })
      .catch((err: any) => {
        this.error = err?.error?.error || err?.message || 'Receive failed';
      })
      .finally(() => {
        this.submitting = false;
        this.focusScan();
      });
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
