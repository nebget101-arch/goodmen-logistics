import {
  Component, Input, Output, EventEmitter,
  ChangeDetectionStrategy, ChangeDetectorRef, OnInit
} from '@angular/core';
import { LoadsService } from '../../../../services/loads.service';

export interface StepBasicsData {
  loadNumber: string;
  status: string;
  billingStatus: string;
  brokerId: string | null;
  brokerName: string;
  poNumber: string;
  rate: number | null;
  dispatcher: string;
  notes: string;
}

/**
 * FN-764: Suggestions derived from recent loads for the selected broker.
 * Displayed as a hint under the PO and Rate fields.
 */
export interface BrokerSuggestion {
  poFormat: string | null;       // e.g. "PO-XXXXX" or "SF-XXXXXX"
  rateMin: number | null;
  rateMax: number | null;
  rateAvg: number | null;
  sampleSize: number;
}

@Component({
  selector: 'app-step-basics',
  templateUrl: './step-basics.component.html',
  styleUrls: ['./step-basics.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StepBasicsComponent implements OnInit {
  @Input() data: StepBasicsData = {
    loadNumber: '', status: 'BOOKED', billingStatus: 'UNBILLED',
    brokerId: null, brokerName: '', poNumber: '',
    rate: null, dispatcher: '', notes: ''
  };

  /** Set of field names that were AI-prefilled — shows sparkle icon */
  @Input() aiPrefilledFields: Set<string> = new Set();

  @Output() valid = new EventEmitter<boolean>();
  @Output() dataChange = new EventEmitter<StepBasicsData>();

  brokers: any[] = [];
  brokerSearch = '';
  showBrokerDropdown = false;
  filteredBrokers: any[] = [];
  showQuickBroker = false;
  quickBrokerName = '';
  showNotes = false;
  validationErrors: string[] = [];

  /** FN-764: Suggestion derived from recent loads for the current broker. */
  brokerSuggestion: BrokerSuggestion | null = null;
  loadingBrokerSuggestion = false;

  readonly statusOptions = [
    'BOOKED', 'DISPATCHED', 'IN_TRANSIT', 'AT_PICKUP', 'AT_DELIVERY',
    'DELIVERED', 'COMPLETED', 'CANCELED'
  ];

  readonly billingStatusOptions = [
    'UNBILLED', 'INVOICED', 'PAID', 'VOID'
  ];

  constructor(private loadsService: LoadsService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadBrokers();
    if (!this.data.loadNumber) {
      this.data.loadNumber = this.generateLoadNumber();
    }
    if (!this.data.dispatcher) {
      const user = JSON.parse(localStorage.getItem('fn_user') || '{}');
      this.data.dispatcher = user?.username || user?.first_name || '';
    }
    // FN-764: if broker was pre-filled (edit / clone / return), fetch suggestions.
    if (this.data.brokerId) {
      this.loadBrokerSuggestion(this.data.brokerId);
    }
  }

  isAiPrefilled(field: string): boolean {
    return this.aiPrefilledFields.has(field);
  }

  get isValid(): boolean {
    return !!(
      this.data.loadNumber?.trim() &&
      this.data.status &&
      this.data.billingStatus
    );
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!this.data.loadNumber?.trim()) errors.push('Load Number is required');
    if (!this.data.status) errors.push('Status is required');
    if (!this.data.billingStatus) errors.push('Billing Status is required');
    this.validationErrors = errors;
    this.valid.emit(errors.length === 0);
    this.cdr.markForCheck();
    return errors;
  }

  onFieldChange(): void {
    this.dataChange.emit({ ...this.data });
    this.valid.emit(this.isValid);
  }

  // ── Broker autocomplete ──

  onBrokerSearch(term: string): void {
    this.brokerSearch = term;
    if (!term) {
      this.filteredBrokers = [];
      this.showBrokerDropdown = false;
      this.cdr.markForCheck();
      return;
    }
    const lower = term.toLowerCase();
    this.filteredBrokers = this.brokers.filter(b =>
      (b.company_name || b.name || '').toLowerCase().includes(lower)
    ).slice(0, 20);
    this.showBrokerDropdown = this.filteredBrokers.length > 0;
    this.cdr.markForCheck();
  }

  selectBroker(broker: any): void {
    this.data.brokerId = broker.id;
    this.data.brokerName = broker.company_name || broker.name || '';
    this.brokerSearch = this.data.brokerName;
    this.showBrokerDropdown = false;
    this.onFieldChange();
    this.loadBrokerSuggestion(broker.id);
    this.cdr.markForCheck();
  }

  clearBroker(): void {
    this.data.brokerId = null;
    this.data.brokerName = '';
    this.brokerSearch = '';
    this.brokerSuggestion = null;
    this.onFieldChange();
    this.cdr.markForCheck();
  }

  // ── FN-764: Broker history → PO format / rate range suggestions ──

  private loadBrokerSuggestion(brokerId: string): void {
    if (!brokerId) { return; }
    this.loadingBrokerSuggestion = true;
    this.brokerSuggestion = null;
    this.loadsService.listLoads({ brokerId, page: 1, pageSize: 20, sortBy: 'created_at', sortDir: 'desc' }).subscribe({
      next: (res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        this.brokerSuggestion = this.computeBrokerSuggestion(rows);
        this.loadingBrokerSuggestion = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingBrokerSuggestion = false;
        this.brokerSuggestion = null;
        this.cdr.markForCheck();
      }
    });
  }

  /** Returns hint text for the PO field, or '' when no suggestion is available. */
  get poHint(): string {
    const s = this.brokerSuggestion;
    if (!s || !s.poFormat) { return ''; }
    return `Typical format for this broker: ${s.poFormat}`;
  }

  /** Returns hint text for the Rate field, or '' when no suggestion is available. */
  get rateHint(): string {
    const s = this.brokerSuggestion;
    if (!s || s.rateAvg == null) { return ''; }
    const fmt = (n: number | null) => n == null ? '' : `$${Math.round(n).toLocaleString()}`;
    if (s.rateMin != null && s.rateMax != null && s.rateMin !== s.rateMax) {
      return `Recent rates: ${fmt(s.rateMin)}–${fmt(s.rateMax)} (avg ${fmt(s.rateAvg)}, ${s.sampleSize} load${s.sampleSize === 1 ? '' : 's'})`;
    }
    return `Recent rate: ${fmt(s.rateAvg)} (${s.sampleSize} load${s.sampleSize === 1 ? '' : 's'})`;
  }

  /** Aggregate PO format and rate stats from recent loads for a broker. */
  private computeBrokerSuggestion(rows: any[]): BrokerSuggestion {
    // PO format: take the most common non-digit prefix across PO numbers,
    // then replace the digit tail with "X"s of the typical length.
    const prefixCounts = new Map<string, number>();
    const digitLengths: number[] = [];
    for (const r of rows) {
      const po = (r?.po_number || r?.poNumber || '').toString().trim();
      if (!po) { continue; }
      const match = po.match(/^([^\d]*)(\d+)/);
      if (!match) { continue; }
      const prefix = match[1];
      const digits = match[2];
      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
      digitLengths.push(digits.length);
    }
    let poFormat: string | null = null;
    if (prefixCounts.size) {
      const topPrefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const typicalLen = digitLengths.length
        ? Math.round(digitLengths.reduce((a, b) => a + b, 0) / digitLengths.length)
        : 5;
      poFormat = `${topPrefix}${'X'.repeat(Math.max(1, typicalLen))}`;
    }

    // Rate stats (ignore null/0 rates).
    const rates: number[] = rows
      .map(r => Number(r?.rate))
      .filter(n => Number.isFinite(n) && n > 0);
    let rateMin: number | null = null, rateMax: number | null = null, rateAvg: number | null = null;
    if (rates.length) {
      rateMin = Math.min(...rates);
      rateMax = Math.max(...rates);
      rateAvg = rates.reduce((a, b) => a + b, 0) / rates.length;
    }

    return { poFormat, rateMin, rateMax, rateAvg, sampleSize: rows.length };
  }

  // ── Quick-create broker ──

  openQuickBroker(): void {
    this.showQuickBroker = true;
    this.quickBrokerName = this.brokerSearch || '';
    this.showBrokerDropdown = false;
    this.cdr.markForCheck();
  }

  cancelQuickBroker(): void {
    this.showQuickBroker = false;
    this.quickBrokerName = '';
    this.cdr.markForCheck();
  }

  saveQuickBroker(): void {
    if (!this.quickBrokerName.trim()) return;
    this.loadsService.createBroker({ companyName: this.quickBrokerName.trim(), legal_name: this.quickBrokerName.trim() }).subscribe({
      next: (res: any) => {
        const created = res?.data || res;
        this.brokers.push(created);
        this.selectBroker(created);
        this.showQuickBroker = false;
        this.quickBrokerName = '';
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      }
    });
  }

  // ── Helpers ──

  private loadBrokers(): void {
    this.loadsService.getBrokers('', 1, 5000).subscribe({
      next: (res: any) => {
        this.brokers = res?.data || [];
        if (this.data.brokerName && !this.brokerSearch) {
          this.brokerSearch = this.data.brokerName;
        }
        this.cdr.markForCheck();
      },
      error: () => { this.brokers = []; }
    });
  }

  private generateLoadNumber(): string {
    const now = new Date();
    const y = String(now.getFullYear()).slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    return `LD-${y}${m}${d}-${seq}`;
  }

  formatRate(): void {
    if (this.data.rate != null && !isNaN(this.data.rate)) {
      this.data.rate = Math.round(this.data.rate * 100) / 100;
    }
    this.onFieldChange();
  }

  toggleNotes(): void {
    this.showNotes = !this.showNotes;
    this.cdr.markForCheck();
  }
}
