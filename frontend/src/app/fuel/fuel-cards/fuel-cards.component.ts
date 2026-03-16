import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { FuelService } from '../fuel.service';
import { FuelCardAccount } from '../fuel.model';

@Component({
  selector: 'app-fuel-cards',
  templateUrl: './fuel-cards.component.html',
  styleUrls: ['./fuel-cards.component.css']
})
export class FuelCardsComponent implements OnInit {
  loading = false;
  error = '';
  cards: FuelCardAccount[] = [];

  showModal = false;
  editing: FuelCardAccount | null = null;
  saving = false;
  form: FormGroup;

  constructor(private fuel: FuelService, private fb: FormBuilder) {
    this.form = this.fb.group({
      provider_name: ['', [Validators.required]],
      display_name: ['', [Validators.required]],
      account_number_masked: [''],
      import_method: ['csv_upload', [Validators.required]],
      status: ['active', [Validators.required]],
      notes: ['']
    });
  }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.fuel.getCards().subscribe({
      next: (cards) => { this.cards = cards; this.loading = false; },
      error: (err) => { this.error = err.error?.error || 'Failed to load fuel cards'; this.loading = false; }
    });
  }

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
}
