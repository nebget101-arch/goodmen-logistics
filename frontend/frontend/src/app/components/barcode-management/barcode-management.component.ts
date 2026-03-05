import { Component, OnInit, OnDestroy } from '@angular/core';
import { ApiService } from '../../services/api.service';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-barcode-management',
  templateUrl: './barcode-management.component.html',
  styleUrls: ['./barcode-management.component.css']
})
export class BarcodeManagementComponent implements OnInit, OnDestroy {
  parts: any[] = [];
  filteredParts: any[] = [];
  selectedPartId = '';
  selectedPart: any = null;
  barcodes: any[] = [];

  search = '';
  barcodeValue = '';
  packQty = 1;
  vendor = '';

  loading = false;
  message = '';
  error = '';

  // Phone bridge for barcode scanning
  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  bridgeEvents: EventSource | null = null;
  qrCodeDataUrl = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadParts();
  }

  ngOnDestroy(): void {
    this.stopPhoneBridge();
  }

  loadParts(): void {
    this.loading = true;
    this.api.getParts({ search: this.search }).subscribe({
      next: (res: any) => {
        this.parts = res?.data || [];
        this.filteredParts = [...this.parts];
        this.loading = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load parts';
        this.loading = false;
      }
    });
  }

  onSearchChange(): void {
    const q = this.search.trim().toLowerCase();
    this.filteredParts = this.parts.filter(p =>
      (p.sku || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q)
    );
  }

  onSelectPart(partId: string): void {
    this.selectedPartId = partId;
    this.selectedPart = this.parts.find(p => p.id === partId) || null;
    this.barcodes = [];
    this.clearMessages();
    if (!partId) return;

    this.api.getPartBarcodes(partId).subscribe({
      next: (res: any) => {
        this.barcodes = res?.data || [];
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load barcodes';
      }
    });
  }

  assignBarcode(): void {
    this.clearMessages();
    if (!this.selectedPartId) {
      this.error = 'Select a part first';
      return;
    }
    if (!this.barcodeValue.trim()) {
      this.error = 'Barcode value is required';
      return;
    }

    this.api.assignPartBarcode(this.selectedPartId, {
      barcodeValue: this.barcodeValue.trim(),
      packQty: this.packQty,
      vendor: this.vendor || undefined
    }).subscribe({
      next: () => {
        this.message = 'Barcode assigned';
        this.barcodeValue = '';
        this.packQty = 1;
        this.vendor = '';
        this.onSelectPart(this.selectedPartId);
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to assign barcode';
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

        // Generate QR code
        if (this.bridgeMobileUrl) {
          QRCode.toDataURL(this.bridgeMobileUrl, {
            width: 250,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          }).then((url: string) => {
            this.qrCodeDataUrl = url;
          }).catch((err: any) => {
            console.error('QR code generation failed', err);
            this.error = 'Failed to generate QR code';
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
            this.barcodeValue = barcode;
            this.message = `Scanned: ${barcode}`;
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
      this.bridgeEvents = null;
    }
    this.bridgeConnected = false;
    this.bridgeMobileUrl = '';
    this.bridgeSessionId = '';
    this.qrCodeDataUrl = '';
    this.bridgeSessionId = '';
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
