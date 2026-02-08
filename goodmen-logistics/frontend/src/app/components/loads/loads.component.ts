import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-loads',
  templateUrl: './loads.component.html',
  styleUrls: ['./loads.component.css']
})
export class LoadsComponent implements OnInit {
  loads: any[] = [];
  loading = true;

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadLoads();
  }

  loadLoads(): void {
    this.apiService.getLoads().subscribe({
      next: (data) => {
        this.loads = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading loads:', error);
        this.loading = false;
      }
    });
  }

  getStatusBadge(status: string): string {
    if (status === 'completed') return 'badge-success';
    if (status === 'in-transit') return 'badge-info';
    if (status === 'pending') return 'badge-warning';
    return 'badge-danger';
  }
}
