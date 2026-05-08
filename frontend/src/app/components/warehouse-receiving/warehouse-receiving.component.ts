import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ApiService, InvoiceUploadResult } from '../../services/api.service';
import * as QRCode from 'qrcode';
import { QuickAddEvent } from './quick-add-panel.component';
import { AppliedSummary } from './invoice-review-modal.component';

interface ReceivingLineView {
  id: string;
  partId: string;
  sku: string;
  name: string;
  qty: number;
  unitCost: number;
  binLocationOverride: string | null;
}

interface ReceivingTicketView {
  id: string;
  ticketNumber: string;
  vendorName: string;
  referenceNumber: string;
  status: 'DRAFT' | 'POSTED';
  lines: ReceivingLineView[];
}

interface TodaySummary {
  partsReceived: number;
  ticketsPosted: number;
}

@Component({
  selector: 'app-warehouse-receiving',
  templateUrl: './warehouse-receiving.component.html',
  styleUrls: ['./warehouse-receiving.component.css']
})
export class WarehouseReceivingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;
  @ViewChild('decodeFileInput') decodeFileInput?: ElementRef<HTMLInputElement>;

  /** FN-1494 — top-level page tabs. */
  activeTab: 'receive' | 'activity' = 'receive';

  locations: any[] = [];
  locationId = '';
  scanCode = '';
  qtyMultiplier = 1;

  ticket: ReceivingTicketView | null = null;
  loadingTicket = false;
  todaySummary: TodaySummary = { partsReceived: 0, ticketsPosted: 0 };

  message = '';
  error = '';
  submitting = false;

  bridgeMobileUrl = '';
  bridgeSessionId = '';
  bridgeConnected = false;
  qrCodeDataUrl = '';
  private bridgeEvents?: EventSource;

  // FN-1491 — invoice upload + review modal state.
  invoiceModalOpen = false;
  invoiceExtracting = false;
  invoiceResult: InvoiceUploadResult | null = null;

  constructor(private api: ApiService) {}

  get lines(): ReceivingLineView[] {
    return this.ticket?.lines ?? [];
  }

  ngOnInit(): void {
    this.api.getLocations().subscribe({
      next: (res: any) => {
        this.locations = res?.data || res || [];
        if (!this.locationId && this.locations.length > 0) {
          const warehouse = this.locations.find((l: any) => (l.name || '').toUpperCase().includes('WAREHOUSE'));
          this.locationId = (warehouse || this.locations[0]).id;
          this.onLocationChange();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    this.focusScan();
  }

  ngOnDestroy(): void {
    this.stopPhoneBridge();
  }

  focusScan(): void {
    setTimeout(() => this.scanInput?.nativeElement.focus(), 0);
  }

  onLocationChange(): void {
    this.clearMessages();
    this.ticket = null;
    if (!this.locationId) return;
    this.loadDraftOrCreate();
    this.refreshTodaySummary();
  }

  private loadDraftOrCreate(): void {
    this.loadingTicket = true;
    this.api.getReceivingDraft(this.locationId).subscribe({
      next: (res: any) => {
        const data = res?.data;
        if (data) {
          this.ticket = this.toTicketView(data);
          this.loadingTicket = false;
          this.focusScan();
        } else {
          this.createDraftTicket();
        }
      },
      error: () => {
        // No DRAFT available (or endpoint not yet wired) → create a fresh one
        this.createDraftTicket();
      }
    });
  }

  private createDraftTicket(): void {
    this.api.createReceivingTicket(this.locationId).subscribe({
      next: (res: any) => {
        this.ticket = this.toTicketView(res?.data);
        this.loadingTicket = false;
        this.focusScan();
      },
      error: (err: any) => {
        this.loadingTicket = false;
        this.error = err?.error?.error || err?.message || 'Failed to create receiving ticket';
      }
    });
  }

  private toTicketView(raw: any): ReceivingTicketView {
    const lines = Array.isArray(raw?.lines) ? raw.lines : [];
    return {
      id: raw.id,
      ticketNumber: raw.ticket_number || raw.ticketNumber || '',
      vendorName: raw.vendor_name || raw.vendorName || '',
      referenceNumber: raw.reference_number || raw.referenceNumber || '',
      status: (raw.status || 'DRAFT') as 'DRAFT' | 'POSTED',
      lines: lines.map((l: any) => ({
        id: l.id,
        partId: l.part_id || l.partId,
        sku: l.sku,
        name: l.name,
        qty: Number(l.qty_received ?? l.qty ?? 0),
        unitCost: Number(l.unit_cost ?? l.unitCost ?? 0),
        binLocationOverride: l.bin_location_override ?? l.binLocationOverride ?? null
      }))
    };
  }

  onScanEnter(): void {
    this.clearMessages();
    const code = this.scanCode.trim();
    if (!code) return;
    if (!this.locationId) {
      this.error = 'Select location';
      return;
    }
    if (!this.ticket) {
      this.error = 'Receiving ticket not ready';
      return;
    }

    const ticketSnapshot = this.ticket;

    this.api.lookupBarcode(code, this.locationId).subscribe({
      next: (res: any) => {
        const part = res?.data?.part;
        const barcode = res?.data?.barcode;
        if (!part || !barcode) {
          this.error = 'Barcode lookup failed';
          this.focusScan();
          return;
        }

        const qty = Number(barcode.pack_qty || 1) * Number(this.qtyMultiplier || 1);
        this.api.addReceivingLine(ticketSnapshot.id, part.id, qty, part.default_cost || undefined).subscribe({
          next: (lineRes: any) => {
            const line = lineRes?.data;
            const view: ReceivingLineView = {
              id: line?.id,
              partId: part.id,
              sku: part.sku,
              name: part.name,
              qty: Number(line?.qty_received ?? qty),
              unitCost: Number(line?.unit_cost ?? part.default_cost ?? 0),
              binLocationOverride: line?.bin_location_override ?? null
            };
            ticketSnapshot.lines = [view, ...ticketSnapshot.lines];
            this.scanCode = '';
            this.message = `Added ${part.sku} x${qty}`;
            this.focusScan();
          },
          error: (err: any) => {
            this.error = err?.error?.error || err?.message || 'Failed to add line';
            this.focusScan();
          }
        });
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

  onQuickAdd(event: QuickAddEvent): void {
    this.clearMessages();
    if (!this.ticket) {
      this.error = 'Receiving ticket not ready';
      return;
    }
    const ticketSnapshot = this.ticket;
    const part = event.part;
    const qty = event.qty;
    const unitCost = part.default_cost != null ? Number(part.default_cost) : undefined;

    this.api.addReceivingLine(ticketSnapshot.id, part.id, qty, unitCost).subscribe({
      next: (lineRes: any) => {
        const line = lineRes?.data;
        const view: ReceivingLineView = {
          id: line?.id,
          partId: part.id,
          sku: part.sku,
          name: part.name,
          qty: Number(line?.qty_received ?? qty),
          unitCost: Number(line?.unit_cost ?? part.default_cost ?? 0),
          binLocationOverride: line?.bin_location_override ?? null
        };
        ticketSnapshot.lines = [view, ...ticketSnapshot.lines];
        this.message = `Added ${part.sku} x${qty}`;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to add line';
      }
    });
  }

  removeLine(line: ReceivingLineView): void {
    if (!this.ticket || !line?.id) return;
    const ticketId = this.ticket.id;
    this.api.deleteReceivingLine(ticketId, line.id).subscribe({
      next: () => {
        if (this.ticket) {
          this.ticket.lines = this.ticket.lines.filter(l => l.id !== line.id);
        }
        this.focusScan();
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to remove line';
      }
    });
  }

  postReceiving(): void {
    this.clearMessages();
    if (!this.ticket || this.ticket.lines.length === 0) {
      this.error = 'At least one line is required';
      return;
    }

    this.submitting = true;
    const ticketSnapshot = this.ticket;
    this.api.postReceivingTicket(ticketSnapshot.id).subscribe({
      next: () => {
        const lineCount = ticketSnapshot.lines.length;
        this.message = `Posted ticket ${ticketSnapshot.ticketNumber} (${lineCount} line${lineCount === 1 ? '' : 's'})`;
        this.ticket = null;
        this.submitting = false;
        this.refreshTodaySummary();
        this.loadDraftOrCreate();
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Receive failed';
        this.submitting = false;
        this.focusScan();
      }
    });
  }

  private refreshTodaySummary(): void {
    if (!this.locationId) return;
    this.api.getReceivingTodaySummary(this.locationId).subscribe({
      next: (res: any) => {
        const data = res?.data || res || {};
        // Backend returns { totalParts, totalLines, totalTickets } (FN-1482).
        // Older snake_case + alternative names tolerated for forward-compat.
        this.todaySummary = {
          partsReceived: Number(data.totalParts ?? data.partsReceived ?? data.parts_received ?? 0),
          ticketsPosted: Number(data.totalTickets ?? data.ticketsPosted ?? data.tickets_posted ?? 0)
        };
      },
      error: () => {
        // Keep last known summary on transient error
      }
    });
  }

  // FN-1491 — Invoice upload card → opens the review modal in extracting state.
  onInvoiceUploadStart(): void {
    this.clearMessages();
    this.invoiceResult = null;
    this.invoiceExtracting = true;
    this.invoiceModalOpen = true;
  }

  onInvoiceExtracted(result: InvoiceUploadResult): void {
    this.invoiceResult = result;
    this.invoiceExtracting = false;
    this.invoiceModalOpen = true;
    // Auto-fill vendor + reference on the ticket header IF the user hasn't
    // already typed values — never overwrite manual input (AC: "Vendor +
    // reference auto-fill … don't overwrite user values").
    const ticket = this.ticket;
    if (ticket) {
      const ext = result.extracted;
      if (ext?.vendor && !ticket.vendorName) {
        ticket.vendorName = ext.vendor;
      }
      if (ext?.reference && !ticket.referenceNumber) {
        ticket.referenceNumber = ext.reference;
      }
    }
  }

  onInvoiceUploadError(message: string): void {
    // Close any in-flight modal so the user sees the error banner directly
    // and can retry from the upload card.
    this.invoiceExtracting = false;
    this.invoiceModalOpen = false;
    this.invoiceResult = null;
    this.error = message;
  }

  onInvoiceModalClosed(): void {
    this.invoiceModalOpen = false;
    this.invoiceExtracting = false;
  }

  onInvoiceLinesApplied(summary: AppliedSummary): void {
    if (summary.appliedCount > 0 && this.ticket) {
      // Refresh the ticket so newly-added lines render with their server ids.
      this.api.getReceivingTicket(this.ticket.id).subscribe({
        next: (res: any) => {
          if (res?.data) this.ticket = this.toTicketView(res.data);
          this.message = `Applied ${summary.appliedCount} line${
            summary.appliedCount === 1 ? '' : 's'
          } from invoice`;
        },
        error: () => {
          this.message = `Applied ${summary.appliedCount} line${
            summary.appliedCount === 1 ? '' : 's'
          } from invoice`;
        }
      });
    }
    if (summary.failedCount > 0) {
      this.error = `${summary.failedCount} line${
        summary.failedCount === 1 ? '' : 's'
      } failed — see modal for details.`;
    }
  }

  private clearMessages(): void {
    this.message = '';
    this.error = '';
  }
}
