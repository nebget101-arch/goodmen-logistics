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
    this.cdr.markForCheck();
  }

  clearBroker(): void {
    this.data.brokerId = null;
    this.data.brokerName = '';
    this.brokerSearch = '';
    this.onFieldChange();
    this.cdr.markForCheck();
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
