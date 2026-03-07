import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  stats: any = {};
  alerts: any[] = [];
  loading = true;

  alertFilterType: 'all' | 'critical' | 'warning' = 'all';
  alertFilterCategory: 'all' | 'driver' | 'vehicle' | 'maintenance' | 'compliance' = 'all';

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadDashboard();
  }

  loadDashboard(): void {
    this.apiService.getDashboardStats().subscribe({
      next: (data) => {
        this.stats = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading dashboard stats:', error);
        this.loading = false;
      }
    });

    this.apiService.getAlerts().subscribe({
      next: (data) => {
        this.alerts = data || [];
      },
      error: (error) => {
        console.error('Error loading alerts:', error);
      }
    });
  }

  get filteredAlerts(): any[] {
    return (this.alerts || []).filter(a => {
      if (this.alertFilterType !== 'all' && a.type !== this.alertFilterType) return false;
      if (this.alertFilterCategory !== 'all' && a.category !== this.alertFilterCategory) return false;
      return true;
    });
  }

  getAlertClass(type: string): string {
    if (type === 'critical' || type === 'danger' || type === 'error') return 'alert-critical';
    if (type === 'warning') return 'alert-warning';
    return 'alert-info';
  }

  getAlertLink(alert: any): string | null {
    if (alert.driverId) return '/drivers/dqf';
    if (alert.vehicleId) return '/vehicles';
    return null;
  }

  getAlertQueryParams(alert: any): any {
    if (alert.driverId) {
      const params: any = { highlight: alert.driverId };
      if (alert.category === 'compliance' && alert.message?.toLowerCase().includes('clearinghouse')) params.filter = 'clearinghouse';
      else if (alert.category === 'compliance' && alert.message?.toLowerCase().includes('dqf')) params.filter = 'dqf-low';
      else if (alert.message?.toLowerCase().includes('medical') || alert.message?.toLowerCase().includes('cdl')) params.filter = 'med-certs';
      return params;
    }
    if (alert.vehicleId) {
      if (alert.category === 'maintenance') return { filter: 'maintenance-due' };
      if (alert.category === 'vehicle') return { filter: 'oos' };
      return { vehicleId: alert.vehicleId };
    }
    return {};
  }
}
