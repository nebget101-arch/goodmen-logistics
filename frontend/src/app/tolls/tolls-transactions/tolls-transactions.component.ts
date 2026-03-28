import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollTransaction } from '../tolls.model';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-tolls-transactions',
  templateUrl: './tolls-transactions.component.html',
  styleUrls: ['./tolls-transactions.component.css']
})
export class TollsTransactionsComponent implements OnInit {
  loading = false;
  error = '';
  rows: TollTransaction[] = [];
  total = 0;

  // Filters
  dateFrom = '';
  dateTo = '';
  driverFilter = '';
  truckFilter = '';

  pageSize = 50;
  pageOffset = 0;

  // Manual entry dialog
  showDialog = false;
  saving = false;
  saveError = '';
  saveSuccess = '';

  form: Record<string, any> = {};

  // Autocomplete data
  trucks: any[] = [];
  drivers: any[] = [];

  constructor(private tolls: TollsService, private api: ApiService) {}

  ngOnInit(): void {
    this.load();
    this.loadAutocompleteData();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.tolls.getTransactions({
      limit: this.pageSize,
      offset: this.pageOffset,
      date_from: this.dateFrom || undefined,
      date_to: this.dateTo || undefined,
    }).subscribe({
      next: (res) => { this.rows = res.rows; this.total = res.total; this.loading = false; },
      error: (err) => { this.error = err.error?.error || 'Failed to load transactions'; this.loading = false; }
    });
  }

  loadAutocompleteData(): void {
    this.api.getVehicles().subscribe({ next: (v: any) => this.trucks = Array.isArray(v) ? v : (v?.rows || []) });
    this.api.getDrivers().subscribe({ next: (d: any) => this.drivers = Array.isArray(d) ? d : (d?.rows || []) });
  }

  applyFilters(): void { this.pageOffset = 0; this.load(); }
  clearFilters(): void { this.dateFrom = ''; this.dateTo = ''; this.driverFilter = ''; this.truckFilter = ''; this.pageOffset = 0; this.load(); }

  get pageNumber(): number { return Math.floor(this.pageOffset / this.pageSize) + 1; }
  get totalPages(): number { return Math.ceil(this.total / this.pageSize); }
  prevPage(): void { if (this.pageOffset > 0) { this.pageOffset -= this.pageSize; this.load(); } }
  nextPage(): void { if (this.pageOffset + this.pageSize < this.total) { this.pageOffset += this.pageSize; this.load(); } }

  openDialog(): void {
    this.form = {
      transaction_date: new Date().toISOString().slice(0, 10),
      provider_name: '',
      plaza_name: '',
      entry_location: '',
      exit_location: '',
      city: '',
      state: '',
      amount: '',
      truck_id: '',
      driver_id: '',
      notes: '',
    };
    this.saveError = '';
    this.saveSuccess = '';
    this.showDialog = true;
  }

  closeDialog(): void { this.showDialog = false; }

  saveTransaction(): void {
    if (!this.form['transaction_date'] || !this.form['provider_name'] || !this.form['amount']) {
      this.saveError = 'Date, Provider, and Amount are required';
      return;
    }
    this.saving = true;
    this.saveError = '';
    this.saveSuccess = '';

    const payload: any = { ...this.form };
    payload.amount = parseFloat(payload.amount);
    if (!payload.truck_id) delete payload.truck_id;
    if (!payload.driver_id) delete payload.driver_id;

    this.tolls.createTransaction(payload).subscribe({
      next: () => {
        this.saving = false;
        this.saveSuccess = 'Toll transaction created successfully';
        this.showDialog = false;
        this.load();
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err.error?.error || 'Failed to create transaction';
      }
    });
  }

  matchClass(status: string): string {
    if (status === 'matched') return 'pill-green';
    if (status === 'partial') return 'pill-yellow';
    return 'pill-red';
  }

  fmtCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);
  }
}
