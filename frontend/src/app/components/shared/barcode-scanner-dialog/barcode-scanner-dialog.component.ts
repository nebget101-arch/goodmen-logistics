import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import { ApiService } from '../../../services/api.service';

/**
 * FN-1107: Reusable barcode-scanner dialog.
 *
 * Wraps the same input methods used at /barcode-management — image decode,
 * phone bridge (QR + SSE), and manual entry — and emits a single `scanned`
 * value for the host to act on. The dialog never closes itself; the host
 * decides whether the captured value is acceptable (e.g., parts-catalog
 * routes match → Edit, no-match → Add). On a malformed/empty decode the
 * dialog shows a toast and stays open so the user can retry.
 */
@Component({
  selector: 'app-barcode-scanner-dialog',
  templateUrl: './barcode-scanner-dialog.component.html',
  styleUrls: ['./barcode-scanner-dialog.component.css'],
})
export class BarcodeScannerDialogComponent implements OnInit, OnDestroy {
  /** Surfaced by the host when its post-scan action (e.g., lookup) fails for a reason that should not close the dialog. */
  @Input() externalError: string | null = null;
  /** Disable the input controls while the host is processing a scan (e.g., lookup in flight). */
  @Input() busy = false;

  @Output() scanned = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('decodeFileInput') decodeFileInput?: ElementRef<HTMLInputElement>;

  manualValue = '';
  decoding = false;
  toast = '';

  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  qrCodeDataUrl = '';
  private bridgeEvents: EventSource | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.stopPhoneBridge();
  }

  triggerDecodeImage(): void {
    if (this.busy || this.decoding) return;
    this.decodeFileInput?.nativeElement?.click();
  }

  onDecodeImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.toast = '';
    this.decoding = true;
    this.api.decodeBarcodeFromImage(file).subscribe({
      next: (res: any) => {
        this.decoding = false;
        const code = (res?.data?.barcode || '').toString().trim();
        input.value = '';
        if (!code) {
          this.toast = 'No barcode found in that image. Try a clearer, well-lit shot.';
          return;
        }
        this.scanned.emit(code);
      },
      error: (err: any) => {
        this.decoding = false;
        input.value = '';
        this.toast = err?.error?.error || err?.message || 'Failed to decode image.';
      },
    });
  }

  submitManual(): void {
    const code = (this.manualValue || '').trim();
    if (!code) {
      this.toast = 'Enter a barcode value.';
      return;
    }
    this.toast = '';
    this.scanned.emit(code);
  }

  startPhoneBridge(): void {
    if (this.busy || this.bridgeConnected || this.bridgeMobileUrl) return;
    this.toast = '';
    this.api.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.bridgeMobileUrl = data.mobileUrl || '';
        this.bridgeSessionId = data.sessionId || '';
        if (this.bridgeMobileUrl) {
          import('qrcode').then(QRCode => QRCode.toDataURL(this.bridgeMobileUrl, {
            width: 220,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          }))
            .then((url: string) => {
              this.qrCodeDataUrl = url;
            })
            .catch(() => {
              this.qrCodeDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(this.bridgeMobileUrl)}`;
            });
        }
        const base = this.api.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.bridgeEvents = new EventSource(eventsUrl);
        this.bridgeEvents.addEventListener('ready', () => {
          this.bridgeConnected = true;
        });
        this.bridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const code = (payload.barcode || '').toString().trim();
            if (!code) {
              this.toast = 'Phone scan returned no value. Try again.';
              return;
            }
            this.scanned.emit(code);
          } catch {
            this.toast = 'Could not parse phone scan payload.';
          }
        });
        this.bridgeEvents.onerror = () => {
          this.bridgeConnected = false;
          this.toast = 'Phone scanner disconnected.';
        };
      },
      error: (err: any) => {
        this.toast = err?.error?.error || err?.message || 'Failed to start phone bridge.';
      },
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

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  close(): void {
    this.stopPhoneBridge();
    this.closed.emit();
  }
}
