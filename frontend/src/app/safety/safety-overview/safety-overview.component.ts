import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SafetyService, SafetyOverview } from '../safety.service';

@Component({
  selector: 'app-safety-overview',
  templateUrl: './safety-overview.component.html',
  styleUrls: ['./safety-overview.component.css']
})
export class SafetyOverviewComponent implements OnInit {
  loading = true;
  error = '';
  overview: SafetyOverview | null = null;

  constructor(private safety: SafetyService, private router: Router) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.safety.getOverview().subscribe({
      next: (data) => { this.overview = data; this.loading = false; },
      error: () => { this.error = 'Failed to load safety overview'; this.loading = false; }
    });
  }

  fmt(n: number | undefined): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n ?? 0);
  }

  goToAccidents(): void { this.router.navigate(['/safety/accidents']); }
  goToClaims(): void { this.router.navigate(['/safety/claims']); }
  goToTasks(): void { this.router.navigate(['/safety/tasks']); }
  goToEntityAccidents(operatingEntityId: string | null): void {
    this.router.navigate(['/safety/accidents'], {
      queryParams: {
        operating_entity_id: operatingEntityId || undefined,
        status: 'open'
      }
    });
  }
  newIncident(): void { this.router.navigate(['/safety/accidents'], { queryParams: { new: '1' } }); }
}
