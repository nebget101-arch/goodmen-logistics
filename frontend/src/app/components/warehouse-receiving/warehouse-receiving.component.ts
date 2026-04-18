import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../services/api.service';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-warehouse-receiving',
  templateUrl: './warehouse-receiving.component.html',
  styleUrls: ['./warehouse-receiving.component.css']
})
export class WarehouseReceivingComponent implements OnInit, AfterViewInit {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;
  @ViewChild('decodeFileInput') decodeFileInput?: ElementRef<HTMLInputElement>;

  locations: any[] = [];
  locationId = '';
  scanCode = '';
  qtyMultiplier = 1;

  lines: Array<{
    partId: string;
    sku: string;
    name: string;
    qty: number;
    unitCostAtTime?: number;
    bin_id_override: string | null;
  }> = [];

  message = '';
  error = '';
  submitting = false;

  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  qrCodeDataUrl = '';
  private bridgeEvents?: EventSource;

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
            unitCostAtTime: part.default_cost || 0,
            bin_id_override: null
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
            this.onScanEnter();
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
    this.decodeFileInput?.nativeElement?.click();
  }

  onDecodeImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.clearMessages();
    this.api.decodeBarcodeFromImage(file).subscribe({
      next: (res: any) => {
        const barcode = res?.data?.barcode;
        if (barcode) {
          this.scanCode = barcode;
          this.onScanEnter();
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
    const payloads = this.lines.map(line => {
      const payload: Record<string, unknown> = {
        locationId: this.locationId,
        partId: line.partId,
        qty: line.qty,
        unitCostAtTime: line.unitCostAtTime,
        referenceType: 'RECEIVING_TICKET',
        referenceId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `recv-${Date.now()}`,
        notes: 'Warehouse receive via scanner'
      };

      // Include bin override when the user selected (or typed) a bin
      if (line.bin_id_override) {
        payload['bin_id_override'] = line.bin_id_override;
      }

      return firstValueFrom(this.api.receiveInventory(payload));
    });

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
