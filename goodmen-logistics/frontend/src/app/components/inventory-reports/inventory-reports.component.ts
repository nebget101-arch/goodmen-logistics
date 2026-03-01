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
  private readonly preferredLocationName = 'garland main warehouse';

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
        this.pickDefaultLocation();
      },
      error: (err: any) => this.error = err?.error?.error || err?.message || 'Failed to load locations'
    });
  }

  private pickDefaultLocation(): void {
    if (!this.locations.length) {
      return;
    }

    this.api.getInventoryLocationSummary().subscribe({
      next: (res: any) => {
        const summary = res?.data || [];
        if (summary.length > 0) {
          const preferred = summary.reduce((best: any, item: any) => {
            const bestQty = Number(best?.on_hand_qty || 0);
            const itemQty = Number(item?.on_hand_qty || 0);
            return itemQty >= bestQty ? item : best;
          }, summary[0]);
          this.locationId = preferred?.id || this.locations[0].id;
        } else {
          const preferred = this.locations.find(
            l => (l.name || '').toString().trim().toLowerCase() === this.preferredLocationName
          );
          this.locationId = (preferred || this.locations[0]).id;
        }
        this.loadOnHand();
        this.loadTransactions();
      },
      error: () => {
        const preferred = this.locations.find(
          l => (l.name || '').toString().trim().toLowerCase() === this.preferredLocationName
        );
        this.locationId = (preferred || this.locations[0]).id;
        this.loadOnHand();
        this.loadTransactions();
      }
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
