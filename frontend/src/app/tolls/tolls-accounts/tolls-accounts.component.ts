import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollAccount } from '../tolls.model';

@Component({
  selector: 'app-tolls-accounts',
  templateUrl: './tolls-accounts.component.html',
  styleUrls: ['./tolls-accounts.component.css']
})
export class TollsAccountsComponent implements OnInit {
  rows: TollAccount[] = [];
  loading = false;
  error = '';

  // Dialog state
  showDialog = false;
  editingAccount: TollAccount | null = null;
  saving = false;
  toast = '';
  toastType: 'success' | 'error' = 'success';

  // Form fields
  formProviderName = '';
  formDisplayName = '';
  formAccountNumber = '';
  formImportMethod = 'csv_upload';
  formNotes = '';

  importMethodOptions = [
    { value: 'csv_upload', label: 'CSV Upload' },
    { value: 'api', label: 'API Integration' },
    { value: 'manual', label: 'Manual Entry' }
  ];

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loadAccounts();
  }

  loadAccounts(): void {
    this.loading = true;
    this.tolls.getAccounts().subscribe({
      next: (rows) => {
        this.rows = rows || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load toll accounts';
        this.loading = false;
      }
    });
  }

  openCreate(): void {
    this.editingAccount = null;
    this.formProviderName = '';
    this.formDisplayName = '';
    this.formAccountNumber = '';
    this.formImportMethod = 'csv_upload';
    this.formNotes = '';
    this.showDialog = true;
  }

  openEdit(account: TollAccount): void {
    this.editingAccount = account;
    this.formProviderName = account.provider_name || '';
    this.formDisplayName = account.display_name || '';
    this.formAccountNumber = account.account_number_masked || '';
    this.formImportMethod = account.import_method || 'csv_upload';
    this.formNotes = account.notes || '';
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingAccount = null;
  }

  get isFormValid(): boolean {
    return !!(this.formProviderName.trim() && this.formDisplayName.trim());
  }

  saveAccount(): void {
    if (!this.isFormValid || this.saving) return;
    this.saving = true;

    const payload: Partial<TollAccount> = {
      provider_name: this.formProviderName.trim(),
      display_name: this.formDisplayName.trim(),
      account_number_masked: this.formAccountNumber.trim() || undefined,
      import_method: this.formImportMethod,
      notes: this.formNotes.trim() || undefined
    };

    const obs = this.editingAccount
      ? this.tolls.updateAccount(this.editingAccount.id, payload)
      : this.tolls.createAccount(payload);

    obs.subscribe({
      next: () => {
        this.saving = false;
        this.showToast(this.editingAccount ? 'Account updated' : 'Account created', 'success');
        this.closeDialog();
        this.loadAccounts();
      },
      error: (err) => {
        this.saving = false;
        this.showToast(err?.error?.error || 'Failed to save account', 'error');
      }
    });
  }

  private showToast(message: string, type: 'success' | 'error'): void {
    this.toast = message;
    this.toastType = type;
    setTimeout(() => { this.toast = ''; }, 4000);
  }
}
