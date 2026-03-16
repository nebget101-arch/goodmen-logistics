import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollImportBatch } from '../tolls.model';

@Component({
  selector: 'app-tolls-history',
  templateUrl: './tolls-history.component.html',
  styleUrls: ['./tolls-history.component.css']
})
export class TollsHistoryComponent implements OnInit {
  rows: TollImportBatch[] = [];
  loading = false;
  error = '';

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loading = true;
    this.tolls.getImportBatches(50, 0).subscribe({
      next: (res) => {
        this.rows = res.rows || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load import history';
        this.loading = false;
      }
    });
  }
}
