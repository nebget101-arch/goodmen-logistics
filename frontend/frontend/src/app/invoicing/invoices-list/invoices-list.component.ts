import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { InvoiceService } from '../../services/invoice.service';
import { CustomerService } from '../../services/customer.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-invoices-list',
  templateUrl: './invoices-list.component.html',
  styleUrls: ['./invoices-list.component.css']
})
export class InvoicesListComponent implements OnInit {
  invoices: any[] = [];
  customers: any[] = [];
  locations: any[] = [];
  loading = false;
  error = '';

  filters: any = {
    search: '',
    status: '',
    customerId: '',
    locationId: '',
    dateFrom: '',
    dateTo: ''
  };

  statuses = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID'];

  constructor(
    private invoiceService: InvoiceService,
    private customerService: CustomerService,
    private apiService: ApiService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadInvoices();
    this.loadCustomers();
    this.loadLocations();
  }

  loadInvoices(): void {
    this.loading = true;
    this.invoiceService.listInvoices(this.filters).subscribe({
      next: (res: any) => {
        this.invoices = res.rows || res.data || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load invoices';
        this.loading = false;
      }
    });
  }

  loadCustomers(): void {
    this.customerService.listCustomers({ pageSize: 200 }).subscribe({
      next: (res: any) => {
        this.customers = res.rows || res.data || [];
      }
    });
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data || []; }
    });
  }

  clearFilters(): void {
    this.filters = { search: '', status: '', customerId: '', locationId: '', dateFrom: '', dateTo: '' };
    this.loadInvoices();
  }

  openInvoice(id: string): void {
    this.router.navigate(['/invoices', id]);
  }
}
