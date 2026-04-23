import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { LoadsService, BrokerOption } from '../../../../services/loads.service';
import { LoadWizardMode } from '../../load-wizard.component';

/**
 * FN-863 / FN-875 — Step 1 (Basics) sub-component for `<app-load-wizard-v2>`.
 *
 * Owns no form state of its own: renders controls bound to the parent wizard's
 * `basics` FormGroup. Adds extra Validators on init (rate ≥ 0, load number
 * required) so `canProceed` in the shell reflects the full set of basics rules.
 */
@Component({
  selector: 'app-load-wizard-basics',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule],
  templateUrl: './basics.component.html',
  styleUrls: ['./basics.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardBasicsComponent implements OnInit, OnChanges {
  @Input({ required: true }) basics!: FormGroup;
  @Input() mode: LoadWizardMode = 'create';

  /** Status options visible in the dropdown for the current `mode`. */
  statusOptions: string[] = [];

  /** Billing-status options (mirrors the legacy manual form). */
  readonly billingStatusOptions = [
    'PENDING',
    'BOL_RECEIVED',
    'INVOICED',
    'SENT_TO_FACTORING',
    'FUNDED',
    'PAID',
    'CANCELLED',
  ];

  /** Initial statuses allowed when creating a brand-new load (per AC). */
  private readonly createStatusOptions = ['DRAFT', 'NEW'];

  /** Full set of statuses for edit/view/ai-extract — taken from LoadStatus union. */
  private readonly allStatusOptions = [
    'DRAFT',
    'NEW',
    'DISPATCHED',
    'EN_ROUTE',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
    'CANCELLED',
    'TONU',
  ];

  // ─── Broker combo state ─────────────────────────────────────────────────
  brokers: BrokerOption[] = [];
  brokerSearch = '';
  filteredBrokers: BrokerOption[] = [];
  showBrokerDropdown = false;
  loadingBrokers = false;

  // ─── Inline "+ Create New Broker" sub-modal ─────────────────────────────
  showBrokerModal = false;
  newBrokerName = '';
  creatingBroker = false;
  brokerCreateError = '';

  // ─── Dispatcher (read-only, prefilled from current user) ────────────────
  currentUserDisplay = '';

  constructor(
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.applyValidators();
    this.applyStatusOptions();
    this.applyModeState();
    this.prefillLoadNumber();
    this.loadBrokers();
    this.prefillDispatcher();
    this.syncBrokerSearchFromValue();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode'] && !changes['mode'].firstChange) {
      this.applyStatusOptions();
      this.applyModeState();
      this.cdr.markForCheck();
    }
  }

  /** Generate a default load number for create mode (matches legacy UX). */
  private prefillLoadNumber(): void {
    if (this.mode !== 'create') return;
    const ctrl = this.basics.get('loadNumber');
    if (!ctrl || (ctrl.value && String(ctrl.value).trim())) return;
    const now = new Date();
    const y = String(now.getFullYear()).slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    ctrl.setValue(`LD-${y}${m}${d}-${seq}`);
  }

  // ─── Form / validators setup ────────────────────────────────────────────

  private applyValidators(): void {
    const loadNumber = this.basics.get('loadNumber');
    if (loadNumber && !loadNumber.hasValidator(Validators.required)) {
      loadNumber.addValidators(Validators.required);
      loadNumber.updateValueAndValidity({ emitEvent: false });
    }

    const rate = this.basics.get('rate');
    if (rate) {
      const validators = [Validators.required, this.nonNegativeNumberValidator];
      rate.setValidators(validators);
      rate.updateValueAndValidity({ emitEvent: false });
    }
  }

  private nonNegativeNumberValidator(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return { numeric: true };
    if (n < 0) return { min: { min: 0, actual: n } };
    return null;
  }

  private applyStatusOptions(): void {
    this.statusOptions = this.mode === 'create'
      ? [...this.createStatusOptions]
      : [...this.allStatusOptions];

    // Make sure the current value is part of the allowed list; if not, fall
    // back to the first allowed option so the dropdown isn't blank.
    const status = this.basics.get('status');
    if (status && !this.statusOptions.includes(status.value)) {
      status.setValue(this.statusOptions[0]);
    }
  }

  private applyModeState(): void {
    if (this.mode === 'view') {
      this.basics.disable({ emitEvent: false });
    } else {
      this.basics.enable({ emitEvent: false });
    }
  }

  // ─── Field helpers exposed to template ──────────────────────────────────

  isView(): boolean {
    return this.mode === 'view';
  }

  hasError(name: string, error: string): boolean {
    const c = this.basics.get(name);
    return !!c && c.touched && c.hasError(error);
  }

  isInvalid(name: string): boolean {
    const c = this.basics.get(name);
    return !!c && c.touched && c.invalid;
  }

  // ─── Rate formatting ────────────────────────────────────────────────────

  formatRate(): void {
    const ctrl = this.basics.get('rate');
    if (!ctrl) return;
    const raw = ctrl.value;
    if (raw === null || raw === undefined || raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const rounded = Math.round(n * 100) / 100;
    if (rounded !== raw) ctrl.setValue(rounded);
  }

  // ─── Brokers ────────────────────────────────────────────────────────────

  private loadBrokers(): void {
    this.loadingBrokers = true;
    this.loadsService.getBrokers('', 1, 5000).subscribe({
      next: (res) => {
        this.brokers = res?.data || [];
        this.loadingBrokers = false;
        // Sync display name in case the parent already set a brokerId.
        this.syncBrokerSearchFromValue();
        this.cdr.markForCheck();
      },
      error: () => {
        this.brokers = [];
        this.loadingBrokers = false;
        this.cdr.markForCheck();
      },
    });
  }

  private syncBrokerSearchFromValue(): void {
    const id = this.basics.get('brokerId')?.value;
    if (!id) return;
    const found = this.brokers.find((b) => b.id === id);
    if (found) this.brokerSearch = this.brokerLabel(found);
  }

  brokerLabel(b: BrokerOption): string {
    return (
      b.display_name?.trim() ||
      b.legal_name?.trim() ||
      b.name?.trim() ||
      b.dba_name?.trim() ||
      'Broker'
    );
  }

  onBrokerSearch(term: string): void {
    this.brokerSearch = term;
    if (!term) {
      this.filteredBrokers = [];
      this.showBrokerDropdown = false;
      this.cdr.markForCheck();
      return;
    }
    const lower = term.toLowerCase();
    this.filteredBrokers = this.brokers
      .filter((b) => this.brokerLabel(b).toLowerCase().includes(lower))
      .slice(0, 25);
    this.showBrokerDropdown = true;
    this.cdr.markForCheck();
  }

  onBrokerInputFocus(): void {
    if (this.brokerSearch && this.filteredBrokers.length) {
      this.showBrokerDropdown = true;
      this.cdr.markForCheck();
    }
  }

  selectBroker(b: BrokerOption): void {
    this.basics.get('brokerId')?.setValue(b.id);
    this.brokerSearch = this.brokerLabel(b);
    this.showBrokerDropdown = false;
    this.cdr.markForCheck();
  }

  clearBroker(): void {
    this.basics.get('brokerId')?.setValue(null);
    this.brokerSearch = '';
    this.filteredBrokers = [];
    this.showBrokerDropdown = false;
    this.cdr.markForCheck();
  }

  // ─── Inline "+ Create New Broker" sub-modal ─────────────────────────────

  openBrokerModal(): void {
    this.newBrokerName = this.brokerSearch?.trim() || '';
    this.brokerCreateError = '';
    this.showBrokerModal = true;
    this.showBrokerDropdown = false;
    this.cdr.markForCheck();
  }

  closeBrokerModal(): void {
    this.showBrokerModal = false;
    this.newBrokerName = '';
    this.brokerCreateError = '';
    this.creatingBroker = false;
    this.cdr.markForCheck();
  }

  saveNewBroker(): void {
    const name = this.newBrokerName.trim();
    if (!name || this.creatingBroker) return;
    this.creatingBroker = true;
    this.brokerCreateError = '';
    this.loadsService
      .createBroker({ companyName: name, legal_name: name })
      .subscribe({
        next: (res) => {
          const created = res?.data;
          if (!created?.id) {
            this.brokerCreateError = 'Failed to create broker.';
            this.creatingBroker = false;
            this.cdr.markForCheck();
            return;
          }
          this.brokers = [created, ...this.brokers];
          this.selectBroker(created);
          this.closeBrokerModal();
        },
        error: (err) => {
          const serverMsg = err?.error?.error || err?.error?.message;
          this.brokerCreateError = serverMsg || 'Failed to create broker.';
          this.creatingBroker = false;
          this.cdr.markForCheck();
        },
      });
  }

  // ─── Dispatcher prefill (matches legacy current-user-as-dispatcher) ─────

  private prefillDispatcher(): void {
    const ctrl = this.basics.get('dispatcherId');
    if (!ctrl) return;

    let user: { id?: string; first_name?: string; last_name?: string; username?: string; email?: string } = {};
    try {
      user = JSON.parse(localStorage.getItem('fn_user') || '{}') || {};
    } catch {
      user = {};
    }

    const display = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
      || user.username
      || user.email
      || '';
    this.currentUserDisplay = display;

    // Only prefill in create mode and only if not already set.
    if (this.mode === 'create' && !ctrl.value && user.id) {
      ctrl.setValue(user.id);
    }
  }

  // ─── Outside click closes the broker dropdown ───────────────────────────

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.showBrokerDropdown) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('.broker-combo')) return;
    this.showBrokerDropdown = false;
    this.cdr.markForCheck();
  }
}
