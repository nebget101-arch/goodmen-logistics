import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FmcsaSafetyService, FmcsaDashboard } from '../fmcsa-safety.service';
import { AccessControlService } from '../../services/access-control.service';

@Component({
  selector: 'app-fmcsa-dashboard',
  templateUrl: './fmcsa-dashboard.component.html',
  styleUrls: ['./fmcsa-dashboard.component.css']
})
export class FmcsaDashboardComponent implements OnInit {
  dashboard: FmcsaDashboard | null = null;
  loading = true;
  scraping = false;
  error = '';

  constructor(
    private fmcsaSafetyService: FmcsaSafetyService,
    private router: Router,
    private accessControl: AccessControlService
  ) {}

  ngOnInit(): void {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.loading = true;
    this.error = '';
    this.fmcsaSafetyService.getDashboard().subscribe({
      next: (data) => {
        this.dashboard = data;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load FMCSA dashboard data';
        this.loading = false;
      }
    });
  }

  triggerScrape(): void {
    this.scraping = true;
    this.fmcsaSafetyService.triggerScrape().subscribe({
      next: () => {
        // Also trigger BASIC detail scraping
        this.fmcsaSafetyService.triggerBasicDetailScrape().subscribe({
          next: () => {
            this.scraping = false;
            this.loadDashboard();
          },
          error: () => {
            // BASIC detail scrape failed but main scrape succeeded
            this.scraping = false;
            this.loadDashboard();
          }
        });
      },
      error: () => {
        this.scraping = false;
        this.error = 'Failed to trigger data scrape';
      }
    });
  }

  navigateToCarrier(id: string): void {
    this.router.navigate(['/safety/fmcsa/carriers', id]);
  }

  getScoreClass(score: number | null): string {
    if (score === null || score === undefined) {
      return 'score-na';
    }
    if (score < 50) {
      return 'score-good';
    }
    if (score < 75) {
      return 'score-warning';
    }
    return 'score-danger';
  }

  getAlertIcon(type: string): string {
    switch (type) {
      case 'high_score':
      case 'score_increase':
        return 'warning';
      case 'insurance_lapse':
        return 'shield';
      case 'authority_issue':
        return 'gavel';
      default:
        return 'notification_important';
    }
  }

  getAlertSeverityClass(type: string): string {
    switch (type) {
      case 'high_score':
      case 'score_increase':
        return 'severity-warning';
      case 'insurance_lapse':
        return 'severity-danger';
      case 'authority_issue':
        return 'severity-danger';
      default:
        return 'severity-info';
    }
  }

  formatAlertType(type: string): string {
    switch (type) {
      case 'high_score':
        return 'High SMS Score';
      case 'score_increase':
        return 'Score Increase';
      case 'insurance_lapse':
        return 'Insurance Lapse';
      case 'authority_issue':
        return 'Authority Issue';
      default:
        return type;
    }
  }

  hasPermission(code: string): boolean {
    return this.accessControl.hasPermission(code);
  }

  canScrape(): boolean {
    return this.accessControl.hasPermission('fmcsa_safety.scrape');
  }
}
