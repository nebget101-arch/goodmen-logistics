import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-maintenance',
  templateUrl: './maintenance.component.html',
  styleUrls: ['./maintenance.component.css']
})
export class MaintenanceComponent implements OnInit {
  workOrders: any[] = [];
  loading = true;
  filters: any = {
    status: '',
    locationId: '',
    type: '',
    invoiceStatus: '',
    search: ''
  };
  locations: any[] = [];
  statuses = ['DRAFT', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED'];
  types = ['REPAIR', 'PM', 'INSPECTION', 'TIRE', 'OTHER'];
  invoiceStatuses = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID'];

  constructor(private apiService: ApiService, private router: Router) { }

  ngOnInit(): void {
    this.loadLocations();
    this.loadWorkOrders();
  }

  goToWorkOrder(): void {
    this.router.navigate(['/work-order']);
  }

  editWorkOrder(record: any): void {
    if (!record?.id) return;
    this.router.navigate(['/work-order', record.id]);
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data || []; }
    });
  }

  loadWorkOrders(): void {
    this.loading = true;
    const filtersWithPageSize = { ...this.filters, pageSize: 10000 };
    this.apiService.listWorkOrders(filtersWithPageSize).subscribe({
      next: (res: any) => {
        this.workOrders = res.rows || res.data || [];
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading work orders:', error);
        this.loading = false;
      }
    });
  }

  applyFilters(): void {
    this.loadWorkOrders();
  }

  clearFilters(): void {
    this.filters = { status: '', locationId: '', type: '', invoiceStatus: '', search: '' };
    this.loadWorkOrders();
  }

  getStatusBadge(status: string): string {
    if (status === 'COMPLETED' || status === 'CLOSED') return 'badge-success';
    if (status === 'WAITING_PARTS') return 'badge-warning';
    if (status === 'CANCELED') return 'badge-danger';
    return 'badge-info';
  }

  getInvoiceBadge(status: string): string {
    if (status === 'PAID') return 'badge-success';
    if (status === 'PARTIAL') return 'badge-warning';
    if (status === 'VOID') return 'badge-danger';
    return 'badge-info';
  }

  generateInvoice(record: any): void {
    if (!record?.id) return;
    this.apiService.generateInvoiceFromWorkOrder(record.id).subscribe({
      next: () => this.loadWorkOrders()
    });
  }
}
