import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-hos',
  templateUrl: './hos.component.html',
  styleUrls: ['./hos.component.css']
})
export class HosComponent implements OnInit {
  hosRecords: any[] = [];
  violations: any[] = [];
  loading = true;

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadHosRecords();
  }

  loadHosRecords(): void {
    this.apiService.getHosRecords().subscribe({
      next: (data) => {
        this.hosRecords = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading HOS records:', error);
        this.loading = false;
      }
    });

    this.apiService.getHosViolations().subscribe({
      next: (data) => {
        this.violations = data;
      },
      error: (error) => {
        console.error('Error loading violations:', error);
      }
    });
  }

  getStatusBadge(status: string): string {
    if (status === 'compliant') return 'badge-success';
    if (status === 'warning') return 'badge-warning';
    return 'badge-danger';
  }
}
