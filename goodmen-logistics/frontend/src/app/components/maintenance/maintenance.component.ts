import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.component.html',
  styleUrls: ['./maintenance.component.css']
})
export class MaintenanceComponent implements OnInit {
  maintenanceRecords: any[] = [];
  pendingRecords: any[] = [];
  loading = true;

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadMaintenance();
  }

  loadMaintenance(): void {
    this.apiService.getMaintenanceRecords().subscribe({
      next: (data) => {
        this.maintenanceRecords = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading maintenance records:', error);
        this.loading = false;
      }
    });

    this.apiService.getPendingMaintenance().subscribe({
      next: (data) => {
        this.pendingRecords = data;
      },
      error: (error) => {
        console.error('Error loading pending maintenance:', error);
      }
    });
  }

  getStatusBadge(status: string): string {
    if (status === 'completed') return 'badge-success';
    if (status === 'pending') return 'badge-warning';
    return 'badge-info';
  }
}
