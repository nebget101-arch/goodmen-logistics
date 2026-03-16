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

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
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
}
