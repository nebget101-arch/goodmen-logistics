import { Component, OnInit } from '@angular/core';
import { TollsService } from '../tolls.service';
import { TollOverview } from '../tolls.model';

@Component({
  selector: 'app-tolls-overview',
  templateUrl: './tolls-overview.component.html',
  styleUrls: ['./tolls-overview.component.css']
})
export class TollsOverviewComponent implements OnInit {
  loading = false;
  error = '';
  overview: TollOverview | null = null;

  constructor(private tolls: TollsService) {}

  ngOnInit(): void {
    this.loading = true;
    this.tolls.getOverview().subscribe({
      next: (data) => {
        this.overview = data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load toll overview';
        this.loading = false;
      }
    });
  }
}
