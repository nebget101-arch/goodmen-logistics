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
  bulkUploadFile: File | null = null;
  bulkUploading = false;
  bulkUploadMessage = '';
  bulkUploadError = '';
  bulkUploadResults: any = null;

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

  setStatusFilter(status: string): void {
    this.filters.status = status;
    this.applyFilters();
  }

  clearFilters(): void {
    this.filters = { status: '', locationId: '', type: '', invoiceStatus: '', search: '' };
    this.loadWorkOrders();
  }

  getActiveFilterCount(): number {
    return ['status', 'locationId', 'type', 'invoiceStatus', 'search']
      .reduce((count, key) => (this.filters[key] ? count + 1 : count), 0);
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

  downloadWorkOrderTemplate(): void {
    this.bulkUploadError = '';
    this.apiService.downloadWorkOrderUploadTemplate().subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'work-order-upload-template.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        this.bulkUploadError = error?.error?.error || error?.message || 'Failed to download template';
      }
    });
  }

  onBulkFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target?.files?.[0] || null;
    this.bulkUploadFile = file;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;
  }

  clearBulkUpload(): void {
    this.bulkUploadFile = null;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;
  }

  uploadBulkWorkOrders(): void {
    if (!this.bulkUploadFile || this.bulkUploading) return;
    this.bulkUploading = true;
    this.bulkUploadMessage = '';
    this.bulkUploadError = '';
    this.bulkUploadResults = null;

    this.apiService.bulkUploadWorkOrders(this.bulkUploadFile).subscribe({
      next: (res: any) => {
        this.bulkUploadMessage = res?.message || 'Bulk upload completed';
        this.bulkUploadResults = res?.results || null;
        this.bulkUploading = false;
        this.loadWorkOrders();
      },
      error: (error) => {
        this.bulkUploadError = error?.error?.error || error?.message || 'Bulk upload failed';
        this.bulkUploading = false;
      }
    });
  }
}
