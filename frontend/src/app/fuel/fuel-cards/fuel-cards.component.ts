import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { FuelService } from '../fuel.service';
import { FuelCardAccount, CardDriverAssignment } from '../fuel.model';
import { ApiService } from '../../services/api.service';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';

interface DriverRow {
  id: string;
  first_name: string;
  last_name: string;
}

@Component({
  selector: 'app-fuel-cards',
  templateUrl: './fuel-cards.component.html',
  styleUrls: ['./fuel-cards.component.css']
})
export class FuelCardsComponent implements OnInit {
  loading = false;
  error = '';
  cards: FuelCardAccount[] = [];

  // ─── Create/Edit modal ────────────────────────────────────────────────────
  showModal = false;
  editing: FuelCardAccount | null = null;
  saving = false;
  form: FormGroup;

  importMethodOptions: AiSelectOption[] = [
    { value: 'csv_upload', label: 'CSV Upload' },
    { value: 'api', label: 'API' },
    { value: 'manual', label: 'Manual' }
  ];

  cardStatusOptions: AiSelectOption[] = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];

  // ─── Assignment state ─────────────────────────────────────────────────────
  drivers: DriverRow[] = [];
  assignedDriverMap: Record<string, CardDriverAssignment> = {};

  showAssignDialog = false;
  assigningCard: FuelCardAccount | null = null;
  assignForm: FormGroup;
  savingAssign = false;

  // ─── History panel ────────────────────────────────────────────────────────
  showHistoryPanel = false;
  historyCard: FuelCardAccount | null = null;
  historyRows: CardDriverAssignment[] = [];
  historyLoading = false;

  constructor(
    private fuel: FuelService,
    private api: ApiService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      provider_name: ['', [Validators.required]],
      display_name: ['', [Validators.required]],
      account_number_masked: [''],
      import_method: ['csv_upload', [Validators.required]],
      status: ['active', [Validators.required]],
      notes: ['']
    });

    this.assignForm = this.fb.group({
      driver_id: ['', Validators.required],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadDrivers();
    this.load();
  }

  // ─── Drivers ──────────────────────────────────────────────────────────────
  loadDrivers(): void {
    this.api.getDrivers().subscribe({
      next: (result: unknown) => {
        const raw = result as { drivers?: DriverRow[] } | DriverRow[];
        if (Array.isArray(raw)) {
          this.drivers = raw;
        } else {
          this.drivers = raw.drivers ?? [];
        }
      },
      error: () => { /* non-critical — silently fail */ }
    });
  }

  driverName(id: string): string {
    const d = this.drivers.find(dr => dr.id === id);
    return d ? `${d.first_name} ${d.last_name}` : id;
  }

  // ─── Load cards + assignments ─────────────────────────────────────────────
  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getCards().subscribe({
      next: (cards) => {
        this.cards = cards;
        this.loading = false;
        this.loadAssignments();
      },
      error: (err) => { this.error = err.error?.error || 'Failed to load fuel cards'; this.loading = false; }
    });
  }

  loadAssignments(): void {
    if (this.cards.length === 0) { return; }
    const requests = this.cards.map(c => this.fuel.getCardAssignments(c.id));
    forkJoin(requests).subscribe({
      next: (results) => {
        const map: Record<string, CardDriverAssignment> = {};
        results.forEach((assignments) => {
          const active = assignments.find(a => a.status === 'active');
          if (active) {
            map[active.fuel_card_account_id] = active;
          }
        });
        this.assignedDriverMap = map;
      },
      error: () => { /* non-critical */ }
    });
  }

  // ─── Create / Edit card modal ─────────────────────────────────────────────
  openCreate(): void {
    this.editing = null;
    this.form.reset({
      provider_name: '',
      display_name: '',
      account_number_masked: '',
      import_method: 'csv_upload',
      status: 'active',
      notes: ''
    });
    this.showModal = true;
  }

  openEdit(card: FuelCardAccount): void {
    this.editing = card;
    this.form.reset({
      provider_name: card.provider_name,
      display_name: card.display_name,
      account_number_masked: card.account_number_masked || '',
      import_method: card.import_method,
      status: card.status,
      notes: card.notes || ''
    });
    this.showModal = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.showModal = false;
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.form.value;
    this.saving = true;

    if (this.editing) {
      this.fuel.updateCard(this.editing.id, payload).subscribe({
        next: () => { this.saving = false; this.showModal = false; this.load(); },
        error: (err) => { this.saving = false; this.error = err.error?.error || 'Failed to update card'; }
      });
      return;
    }

    this.fuel.createCard(payload).subscribe({
      next: () => { this.saving = false; this.showModal = false; this.load(); },
      error: (err) => { this.saving = false; this.error = err.error?.error || 'Failed to create card'; }
    });
  }

  deactivate(card: FuelCardAccount): void {
    if (!confirm(`Deactivate ${card.display_name}?`)) return;
    this.fuel.updateCard(card.id, { status: 'inactive' }).subscribe({
      next: () => this.load(),
      error: (err) => { this.error = err.error?.error || 'Failed to deactivate card'; }
    });
  }

  statusClass(status: string): string {
    if (status === 'active') return 'pill-green';
    if (status === 'inactive') return 'pill-red';
    return 'pill-neutral';
  }

  // ─── Assignment dialog ────────────────────────────────────────────────────
  openAssignDialog(card: FuelCardAccount): void {
    this.assigningCard = card;
    this.assignForm.reset({ driver_id: '', notes: '' });
    this.showAssignDialog = true;
  }

  closeAssignDialog(): void {
    if (this.savingAssign) return;
    this.showAssignDialog = false;
  }

  saveAssignment(): void {
    if (this.assignForm.invalid || !this.assigningCard) {
      this.assignForm.markAllAsTouched();
      return;
    }
    const { driver_id, notes } = this.assignForm.value as { driver_id: string; notes: string };
    this.savingAssign = true;
    this.fuel.assignDriver(this.assigningCard.id, driver_id, notes || undefined).subscribe({
      next: () => {
        this.savingAssign = false;
        this.showAssignDialog = false;
        this.loadAssignments();
      },
      error: (err) => {
        this.savingAssign = false;
        this.error = err.error?.error || 'Failed to assign driver';
      }
    });
  }

  revokeAssignment(card: FuelCardAccount): void {
    if (!confirm(`Revoke driver assignment for ${card.display_name}?`)) return;
    this.fuel.revokeDriver(card.id).subscribe({
      next: () => this.loadAssignments(),
      error: (err) => { this.error = err.error?.error || 'Failed to revoke assignment'; }
    });
  }

  // ─── History panel ────────────────────────────────────────────────────────
  openHistory(card: FuelCardAccount): void {
    this.historyCard = card;
    this.historyLoading = true;
    this.showHistoryPanel = true;
    this.fuel.getCardAssignments(card.id).subscribe({
      next: (rows) => { this.historyRows = rows; this.historyLoading = false; },
      error: () => { this.historyRows = []; this.historyLoading = false; }
    });
  }

  closeHistory(): void {
    this.showHistoryPanel = false;
  }
}
