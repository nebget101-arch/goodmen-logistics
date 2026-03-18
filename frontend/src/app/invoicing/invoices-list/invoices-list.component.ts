import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { InvoiceService } from '../../services/invoice.service';
import { ShopClientsService } from '../../services/shop-clients.service';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';

@Component({
  selector: 'app-invoices-list',
  templateUrl: './invoices-list.component.html',
  styleUrls: ['./invoices-list.component.css']
})
export class InvoicesListComponent implements OnInit, OnDestroy {
  readonly perms = PERMISSIONS;
  invoices: any[] = [];
  customers: any[] = [];
  locations: any[] = [];
  loading = false;
  error = '';
  activeOperatingEntityName = '';

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

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
    private customerService: ShopClientsService,
    private apiService: ApiService,
    private router: Router,
    private operatingEntityContext: OperatingEntityContextService,
    private permissions: PermissionHelperService
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.loadInvoices();
    this.loadCustomers();
    this.loadLocations();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.loadInvoices();
        }
      });
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

  createInvoice(): void {
    if (!this.canCreateDraftInvoice()) {
      this.error = 'You do not have permission to create draft invoices.';
      return;
    }

    this.error = '';
    const customerId = this.filters.customerId;
    const locationId = this.filters.locationId;

    if (!customerId || !locationId) {
      this.error = 'To create a new invoice, select a Customer and Location in filters first.';
      return;
    }

    this.invoiceService.createInvoice({
      customerId,
      locationId,
      paymentTerms: 'DUE_ON_RECEIPT',
      lineItems: []
    }).subscribe({
      next: (res: any) => {
        const id = res?.data?.id || res?.id;
        if (!id) {
          this.error = 'Invoice was created but no invoice id was returned.';
          this.loadInvoices();
          return;
        }
        this.router.navigate(['/invoices', id]);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to create invoice draft';
      }
    });
  }

  getStatusClass(status: string): string {
    const normalized = (status || '').toLowerCase();
    if (normalized.includes('draft')) return 'draft';
    if (normalized.includes('pending') || normalized.includes('sent')) return 'pending';
    if (normalized.includes('paid')) return 'paid';
    if (normalized.includes('overdue') || normalized.includes('void')) return 'overdue';
    return 'draft';
  }

  canCreateDraftInvoice(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT]);
  }
}
