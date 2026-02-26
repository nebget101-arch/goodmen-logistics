import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CustomerService } from '../../services/customer.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-customers-list',
  templateUrl: './customers-list.component.html',
  styleUrls: ['./customers-list.component.css']
})
export class CustomersListComponent implements OnInit {
  customers: any[] = [];
  loading = false;
  error = '';
  locations: any[] = [];

  filters: any = {
    search: '',
    type: '',
    status: '',
    locationId: '',
    paymentTerms: ''
  };

  page = 1;
  pageSize = 20;
  total = 0;

  get totalPages(): number {
    return Math.ceil(this.total / this.pageSize);
  }

  Math = Math; // Expose Math for template usage

  customerTypes = ['FLEET', 'WALK_IN', 'INTERNAL', 'WARRANTY'];
  statuses = ['ACTIVE', 'INACTIVE'];
  paymentTerms = ['DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'CUSTOM'];

  constructor(
    private customerService: CustomerService,
    private router: Router,
    private apiService: ApiService
  ) {}

  ngOnInit(): void {
    this.loadCustomers();
    this.loadLocations();
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data || []; },
      error: () => { this.locations = []; }
    });
  }

  loadCustomers(): void {
    this.loading = true;
    this.customerService.listCustomers({
      search: this.filters.search,
      type: this.filters.type,
      status: this.filters.status,
      locationId: this.filters.locationId,
      paymentTerms: this.filters.paymentTerms,
      page: this.page,
      pageSize: this.pageSize
    }).subscribe({
      next: (res: any) => {
        this.customers = res.rows || res.data || [];
        this.total = res.total || this.customers.length;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load customers';
        this.loading = false;
      }
    });
  }

  clearFilters(): void {
    this.filters = { search: '', type: '', status: '', locationId: '', paymentTerms: '' };
    this.loadCustomers();
  }

  goToNew(): void {
    this.router.navigate(['/customers/new']);
  }

  viewCustomer(id: string): void {
    this.router.navigate(['/customers', id]);
  }

  editCustomer(id: string): void {
    this.router.navigate(['/customers', id, 'edit']);
  }

  toggleStatus(customer: any): void {
    const nextStatus = customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    this.customerService.setStatus(customer.id, nextStatus).subscribe({
      next: () => this.loadCustomers(),
      error: () => this.loadCustomers()
    });
  }

  previousPage(): void {
    if (this.page > 1) {
      this.page--;
      this.loadCustomers();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.loadCustomers();
    }
  }

  goToPage(pageNumber: number): void {
    this.page = pageNumber;
    this.loadCustomers();
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxPages = Math.min(this.totalPages, 5); // Show max 5 page buttons
    let startPage = Math.max(1, this.page - 2);
    let endPage = Math.min(this.totalPages, startPage + 4);

    // Adjust startPage if we're near the end
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  }
}
