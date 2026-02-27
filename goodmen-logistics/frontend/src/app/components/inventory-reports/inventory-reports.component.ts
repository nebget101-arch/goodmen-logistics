import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-inventory-reports',
  templateUrl: './inventory-reports.component.html',
  styleUrls: ['./inventory-reports.component.css']
})
export class InventoryReportsComponent implements OnInit {
  locations: any[] = [];
  locationId = '';

  onHandRows: any[] = [];
  txRows: any[] = [];

  filters = {
    txType: '',
    dateFrom: '',
    dateTo: ''
  };

  loadingOnHand = false;
  loadingTx = false;
  error = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getLocations().subscribe({
      next: (res: any) => {
        this.locations = res?.data || res || [];
        if (this.locations.length > 0) this.locationId = this.locations[0].id;
        this.loadOnHand();
        this.loadTransactions();
      },
      error: (err: any) => this.error = err?.error?.error || err?.message || 'Failed to load locations'
    });
  }

  loadOnHand(): void {
    if (!this.locationId) return;
    this.loadingOnHand = true;
    this.api.getInventory(this.locationId).subscribe({
      next: (res: any) => {
        this.onHandRows = res?.data || [];
        this.loadingOnHand = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load on-hand';
        this.loadingOnHand = false;
      }
    });
  }

  loadTransactions(): void {
    this.loadingTx = true;
    this.api.getInventoryTransactions({
      locationId: this.locationId,
      txType: this.filters.txType,
      dateFrom: this.filters.dateFrom,
      dateTo: this.filters.dateTo,
      limit: 300
    }).subscribe({
      next: (res: any) => {
        this.txRows = res?.data || [];
        this.loadingTx = false;
      },
      error: (err: any) => {
        this.error = err?.error?.error || err?.message || 'Failed to load transaction history';
        this.loadingTx = false;
      }
    });
  }
}
