import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { FuelService } from '../fuel.service';
import { FuelCardAccount, FuelCard, CardDriverAssignment } from '../fuel.model';
import { ApiService } from '../../services/api.service';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

/** Matches GET /api/drivers (camelCase from transformRows). */
interface DriverRow {
  id: string;
  firstName?: string;
  lastName?: string;
  first_name?: string;
  last_name?: string;
}

type ViewMode = 'accounts' | 'cards';

@Component({
  selector: 'app-fuel-cards',
  templateUrl: './fuel-cards.component.html',
  styleUrls: ['./fuel-cards.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FuelCardsComponent implements OnInit {
  loading = false;
  error = '';

  // ─── View mode ─────────────────────────────────────────────────────────────
  viewMode: ViewMode = 'accounts';

  // ─── Accounts (primary view) ───────────────────────────────────────────────
  accounts: FuelCardAccount[] = [];
  assignedDriverCountMap: Record<string, number> = {};

  // ─── Cards (detail view under selected account) ────────────────────────────
  selectedAccount: FuelCardAccount | null = null;
  cards: FuelCard[] = [];
  cardsLoading = false;
  cardAssignmentMap: Record<string, CardDriverAssignment> = {};

  // ─── Create/Edit Account modal ─────────────────────────────────────────────
  showAccountModal = false;
  editingAccount: FuelCardAccount | null = null;
  savingAccount = false;
  accountForm: FormGroup;

  importMethodOptions: AiSelectOption[] = [
    { value: 'csv_upload', label: 'CSV Upload' },
    { value: 'api', label: 'API' },
    { value: 'manual', label: 'Manual' }
  ];

  cardStatusOptions: AiSelectOption[] = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];

  // ─── Create Card modal ────────────────────────────────────────────────────
  showCardModal = false;
  savingCard = false;
  cardForm: FormGroup;

  cardStatusSelectOptions: AiSelectOption[] = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'lost', label: 'Lost' },
    { value: 'stolen', label: 'Stolen' }
  ];

  // ─── Driver assignment ─────────────────────────────────────────────────────
  drivers: DriverRow[] = [];
  showAssignDialog = false;
  assigningCard: FuelCard | null = null;
  assignForm: FormGroup;
  savingAssign = false;

  // ─── History panel ─────────────────────────────────────────────────────────
  showHistoryPanel = false;
  historyCard: FuelCard | null = null;
  historyRows: CardDriverAssignment[] = [];
  historyLoading = false;

  constructor(
    private fuel: FuelService,
    private api: ApiService,
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef
  ) {
    this.accountForm = this.fb.group({
      provider_name: ['', [Validators.required]],
      display_name: ['', [Validators.required]],
      account_number_masked: [''],
      import_method: ['csv_upload', [Validators.required]],
      status: ['active', [Validators.required]],
      notes: ['']
    });

    this.cardForm = this.fb.group({
      card_number_full: ['', [Validators.required, Validators.minLength(4)]],
      card_number_masked: [''],
      card_number_last4: [''],
      status: ['active'],
      notes: ['']
    });

    this.assignForm = this.fb.group({
      driver_id: ['', Validators.required],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadDrivers();
    this.loadAccounts();
  }

  // ─── Drivers ───────────────────────────────────────────────────────────────
  loadDrivers(): void {
    this.api.getDrivers().subscribe({
      next: (result: unknown) => {
        const raw = result as { drivers?: DriverRow[]; rows?: DriverRow[]; data?: DriverRow[] } | DriverRow[];
        if (Array.isArray(raw)) {
          this.drivers = raw;
        } else {
          this.drivers = raw.drivers ?? raw.rows ?? raw.data ?? [];
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.drivers = [];
        this.cdr.markForCheck();
      }
    });
  }

  driverOptionLabel(d: DriverRow): string {
    const fn = d.firstName ?? d.first_name ?? '';
    const ln = d.lastName ?? d.last_name ?? '';
    const label = `${fn} ${ln}`.trim();
    return label || d.id;
  }

  /** Display name for a driver id; API list uses camelCase; assignments may include driver_name from API. */
  driverDisplayName(id: string, assignment?: CardDriverAssignment): string {
    const joined = assignment?.driver_name?.trim();
    if (joined) return joined;
    const d = this.drivers.find(dr => dr.id === id);
    if (!d) return id;
    const fn = d.firstName ?? d.first_name ?? '';
    const ln = d.lastName ?? d.last_name ?? '';
    const label = `${fn} ${ln}`.trim();
    return label || id;
  }

  // ─── Load accounts ─────────────────────────────────────────────────────────
  loadAccounts(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getCards().subscribe({
      next: (accounts) => {
        this.accounts = accounts;
        this.loading = false;
        this.loadAssignedDriverCounts();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.error?.error || 'Failed to load fuel card accounts';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadAssignedDriverCounts(): void {
    if (this.accounts.length === 0) return;
    const requests = this.accounts.map(a => this.fuel.getCardAssignments(a.id));
    forkJoin(requests).subscribe({
      next: (results) => {
        const map: Record<string, number> = {};
        results.forEach((assignments, idx) => {
          map[this.accounts[idx].id] = assignments.filter(a => a.status === 'active').length;
        });
        this.assignedDriverCountMap = map;
        this.cdr.markForCheck();
      },
      error: () => { /* non-critical */ }
    });
  }

  // ─── Navigate to card detail ───────────────────────────────────────────────
  selectAccount(account: FuelCardAccount): void {
    this.selectedAccount = account;
    this.viewMode = 'cards';
    this.loadCards();
  }

  backToAccounts(): void {
    this.viewMode = 'accounts';
    this.selectedAccount = null;
    this.cards = [];
    this.cardAssignmentMap = {};
    this.loadAccounts();
  }

  loadCards(): void {
    if (!this.selectedAccount) return;
    this.cardsLoading = true;
    this.error = '';
    this.fuel.getAccountCards(this.selectedAccount.id).subscribe({
      next: (cards) => {
        this.cards = cards;
        this.cardsLoading = false;
        this.loadCardAssignments();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err.error?.error || 'Failed to load cards';
        this.cardsLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadCardAssignments(): void {
    if (!this.selectedAccount || this.cards.length === 0) return;
    this.fuel.getCardAssignments(this.selectedAccount.id).subscribe({
      next: (assignments) => {
        const map: Record<string, CardDriverAssignment> = {};
        const active = assignments.filter(a => a.status === 'active');
        active.forEach(a => {
          if (a.fuel_card_id) {
            map[a.fuel_card_id] = a;
          }
        });
        // Rows often have no fuel_card_id (account-level assignment); match last4 or mirror to all cards.
        active.forEach(a => {
          if (a.fuel_card_id) return;
          const last4 = a.card_number_last4;
          if (last4) {
            const card = this.cards.find(c => c.card_number_last4 === last4);
            if (card) map[card.id] = a;
          } else {
            for (const c of this.cards) {
              map[c.id] = a;
            }
          }
        });
        this.cardAssignmentMap = map;
        this.cdr.markForCheck();
      },
      error: () => { /* non-critical */ }
    });
  }

  // ─── Account modal ─────────────────────────────────────────────────────────
  openCreateAccount(): void {
    this.editingAccount = null;
    this.accountForm.reset({
      provider_name: '',
      display_name: '',
      account_number_masked: '',
      import_method: 'csv_upload',
      status: 'active',
      notes: ''
    });
    this.showAccountModal = true;
    this.cdr.markForCheck();
  }

  openEditAccount(account: FuelCardAccount): void {
    this.editingAccount = account;
    this.accountForm.reset({
      provider_name: account.provider_name,
      display_name: account.display_name,
      account_number_masked: account.account_number_masked || '',
      import_method: account.import_method,
      status: account.status,
      notes: account.notes || ''
    });
    this.showAccountModal = true;
    this.cdr.markForCheck();
  }

  closeAccountModal(): void {
    if (this.savingAccount) return;
    this.showAccountModal = false;
    this.cdr.markForCheck();
  }

  saveAccount(): void {
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    const payload = this.accountForm.value;
    this.savingAccount = true;

    if (this.editingAccount) {
      this.fuel.updateCard(this.editingAccount.id, payload).subscribe({
        next: () => { this.savingAccount = false; this.showAccountModal = false; this.loadAccounts(); this.cdr.markForCheck(); },
        error: (err) => { this.savingAccount = false; this.error = err.error?.error || 'Failed to update account'; this.cdr.markForCheck(); }
      });
      return;
    }

    this.fuel.createCard(payload).subscribe({
      next: () => { this.savingAccount = false; this.showAccountModal = false; this.loadAccounts(); this.cdr.markForCheck(); },
      error: (err) => { this.savingAccount = false; this.error = err.error?.error || 'Failed to create account'; this.cdr.markForCheck(); }
    });
  }

  deactivateAccount(account: FuelCardAccount, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Deactivate ${account.display_name}?`)) return;
    this.fuel.updateCard(account.id, { status: 'inactive' }).subscribe({
      next: () => this.loadAccounts(),
      error: (err) => { this.error = err.error?.error || 'Failed to deactivate account'; this.cdr.markForCheck(); }
    });
  }

  editAccountEvent(account: FuelCardAccount, event: Event): void {
    event.stopPropagation();
    this.openEditAccount(account);
  }

  // ─── Card modal ────────────────────────────────────────────────────────────
  onCardNumberInput(value: string): void {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 4) {
      const last4 = digits.slice(-4);
      this.cardForm.patchValue({ card_number_last4: last4, card_number_masked: `****${last4}` });
    } else {
      this.cardForm.patchValue({ card_number_last4: '', card_number_masked: '' });
    }
  }

  openCreateCard(): void {
    this.cardForm.reset({
      card_number_full: '',
      card_number_masked: '',
      card_number_last4: '',
      status: 'active',
      notes: ''
    });
    this.showCardModal = true;
    this.cdr.markForCheck();
  }

  closeCardModal(): void {
    if (this.savingCard) return;
    this.showCardModal = false;
    this.cdr.markForCheck();
  }

  saveCard(): void {
    if (this.cardForm.invalid || !this.selectedAccount) {
      this.cardForm.markAllAsTouched();
      return;
    }
    const { card_number_masked, card_number_last4, status, notes } = this.cardForm.value as {
      card_number_full: string; card_number_masked: string; card_number_last4: string; status: 'active' | 'inactive' | 'lost' | 'stolen'; notes: string;
    };
    const payload = { card_number_masked, card_number_last4, status, notes };
    this.savingCard = true;
    this.fuel.createAccountCard(this.selectedAccount.id, payload).subscribe({
      next: () => { this.savingCard = false; this.showCardModal = false; this.loadCards(); this.cdr.markForCheck(); },
      error: (err) => { this.savingCard = false; this.error = err.error?.error || 'Failed to create card'; this.cdr.markForCheck(); }
    });
  }

  // ─── Card status helpers ───────────────────────────────────────────────────
  statusClass(status: string): string {
    switch (status) {
      case 'active': return 'pill-green';
      case 'inactive': return 'pill-red';
      case 'lost':
      case 'stolen': return 'pill-orange';
      default: return 'pill-neutral';
    }
  }

  activeCardCount(account: FuelCardAccount): number {
    // card_count from the backend represents total cards; if not available fall back to 0
    return account.card_count ?? 0;
  }

  // ─── Assignment dialog (cards view) ────────────────────────────────────────
  openAssignDialog(card: FuelCard): void {
    this.assigningCard = card;
    this.assignForm.reset({ driver_id: '', notes: '' });
    this.showAssignDialog = true;
    this.cdr.markForCheck();
  }

  closeAssignDialog(): void {
    if (this.savingAssign) return;
    this.showAssignDialog = false;
    this.cdr.markForCheck();
  }

  saveAssignment(): void {
    if (this.assignForm.invalid || !this.assigningCard || !this.selectedAccount) {
      this.assignForm.markAllAsTouched();
      return;
    }
    const { driver_id, notes } = this.assignForm.value as { driver_id: string; notes: string };
    this.savingAssign = true;
    const last4 = this.assigningCard?.card_number_last4 || undefined;
    const fuelCardId = this.assigningCard.id;
    this.fuel.assignDriver(this.selectedAccount.id, driver_id, notes || undefined, last4, fuelCardId).subscribe({
      next: () => {
        this.savingAssign = false;
        this.showAssignDialog = false;
        this.loadCardAssignments();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.savingAssign = false;
        this.error = err.error?.error || 'Failed to assign driver';
        this.cdr.markForCheck();
      }
    });
  }

  revokeAssignment(card: FuelCard): void {
    if (!this.selectedAccount) return;
    if (!confirm(`Revoke driver assignment for card ****${card.card_number_last4 || ''}?`)) return;
    this.fuel.revokeDriver(
      this.selectedAccount.id,
      undefined,
      card.id,
      card.card_number_last4 || undefined
    ).subscribe({
      next: () => { this.loadCardAssignments(); },
      error: (err) => { this.error = err.error?.error || 'Failed to revoke assignment'; this.cdr.markForCheck(); }
    });
  }

  // ─── History panel ─────────────────────────────────────────────────────────
  openHistory(card: FuelCard): void {
    if (!this.selectedAccount) return;
    this.historyCard = card;
    this.historyLoading = true;
    this.showHistoryPanel = true;
    this.cdr.markForCheck();
    this.fuel.getCardAssignments(this.selectedAccount.id, card.id).subscribe({
      next: (rows) => { this.historyRows = rows; this.historyLoading = false; this.cdr.markForCheck(); },
      error: () => { this.historyRows = []; this.historyLoading = false; this.cdr.markForCheck(); }
    });
  }

  closeHistory(): void {
    this.showHistoryPanel = false;
    this.cdr.markForCheck();
  }
}
