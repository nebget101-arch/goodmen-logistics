import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CustomerService } from '../../services/customer.service';
import { InvoiceService } from '../../services/invoice.service';
import { CreditService } from '../../services/credit.service';

@Component({
  selector: 'app-customer-detail',
  templateUrl: './customer-detail.component.html',
  styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit {
  customer: any;
  pricing: any;
  alerts: any;
  notes: any[] = [];
  workOrders: any[] = [];
  serviceHistory: any[] = [];
  vehicles: any[] = [];
  invoices: any[] = [];
  creditBalance: any;
  creditTransactions: any[] = [];
  newCreditLimit: number | null = null;
  updatingCreditLimit = false;
  creditLimitSuccess = false;

  loading = false;
  error = '';
  activeTab: 'overview' | 'work-orders' | 'service-history' | 'pricing' | 'notes' | 'vehicles' | 'invoices' | 'credit' = 'overview';
  pricingSuccess = false;

  pricingForm: FormGroup;

  notePayload: { note_type: 'GENERAL' | 'BILLING' | 'SERVICE_ISSUE'; note: string } = {
    note_type: 'GENERAL',
    note: ''
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private customerService: CustomerService,
    private invoiceService: InvoiceService,
    private creditService: CreditService,
    private fb: FormBuilder
  ) {
    this.pricingForm = this.fb.group({
      labor_rate_multiplier: [null],
      markup_percentage: [null],
      discount_percentage: [null],
      effective_date: [null],
      end_date: [null]
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loadCustomer(id);
  }

  loadCustomer(id: string): void {
    this.loading = true;
    this.customerService.getCustomer(id).subscribe({
      next: (res: any) => {
        this.customer = res.customer || res.data?.customer || res.customer;
        this.pricing = res.effectivePricing || res.data?.effectivePricing || res.effectivePricing;
        this.alerts = res.alerts || res.data?.alerts || res.alerts;
        this.loading = false;
        // Load related data using the UUID from the customer object
        if (this.customer?.id) {
          this.loadNotes(this.customer.id);
          this.loadWorkOrders(this.customer.id);
          this.loadServiceHistory(this.customer.id);
          this.loadVehicles(this.customer.id);
          this.loadInvoices(this.customer.id);
          this.loadCreditBalance(this.customer.id);
          this.loadCreditTransactions(this.customer.id);
        }
      },
      error: () => {
        this.error = 'Failed to load customer';
        this.loading = false;
      }
    });
  }

  loadNotes(id: string): void {
    this.customerService.getNotes(id).subscribe({
      next: (res: any) => {
        this.notes = res.data || [];
      },
      error: (err) => {
        console.error('Failed to load notes:', err);
        this.notes = [];
      }
    });
  }

  loadWorkOrders(id: string): void {
    this.customerService.getWorkOrders(id, { pageSize: 20 }).subscribe({
      next: (res: any) => {
        this.workOrders = res.rows || res.data || [];
      },
      error: (err) => {
        console.error('Failed to load work orders:', err);
        this.workOrders = [];
      }
    });
  }

  loadServiceHistory(id: string): void {
    this.customerService.getServiceHistory(id, { pageSize: 20 }).subscribe({
      next: (res: any) => {
        this.serviceHistory = res.rows || res.data || [];
      },
      error: (err) => {
        console.error('Failed to load service history:', err);
        this.serviceHistory = [];
      }
    });
  }

  loadVehicles(id: string): void {
    this.customerService.getVehicles(id, { pageSize: 20 }).subscribe({
      next: (res: any) => {
        this.vehicles = res.rows || res.data || [];
      },
      error: (err) => {
        console.error('Failed to load vehicles:', err);
        this.vehicles = [];
      }
    });
  }

  loadInvoices(id: string): void {
    this.invoiceService.listInvoices({ customerId: id, pageSize: 1000 }).subscribe({
      next: (res: any) => {
        const rows = res.rows || res.data || [];
        this.invoices = rows.filter((inv: any) => !!inv.work_order_id);
      },
      error: (err) => {
        console.error('Failed to load invoices:', err);
        this.invoices = [];
      }
    });
  }

  getWorkOrderNumber(workOrderId: string): string {
    if (!workOrderId) return '—';
    const match = this.workOrders.find(wo => wo.id === workOrderId);
    return match?.work_order_number || workOrderId;
  }

  addNote(): void {
    if (!this.customer?.id || !this.notePayload.note) return;
    this.customerService.addNote(this.customer.id, this.notePayload).subscribe({
      next: () => {
        this.notePayload = { note_type: 'GENERAL', note: '' };
        this.loadNotes(this.customer.id);
      }
    });
  }

  editCustomer(): void {
    if (!this.customer?.id) return;
    this.router.navigate(['/customers', this.customer.id, 'edit']);
  }

  savePricingRules(): void {
    if (!this.customer?.id || !this.pricingForm.valid) return;
    
    const pricingData = this.pricingForm.getRawValue();
    // Remove null values
    const payload = Object.keys(pricingData).reduce((acc: any, key) => {
      if (pricingData[key] !== null && pricingData[key] !== '') {
        acc[key] = pricingData[key];
      }
      return acc;
    }, {});

    if (Object.keys(payload).length === 0) {
      alert('Please fill in at least one pricing field');
      return;
    }

    this.customerService.updatePricing(this.customer.id, payload).subscribe({
      next: (res: any) => {
        this.pricing = res?.data || this.pricing;
        this.pricingSuccess = true;
        setTimeout(() => this.pricingSuccess = false, 3000);
      },
      error: (err) => {
        console.error('Failed to save pricing:', err);
        alert('Failed to save pricing rules: ' + (err?.error?.error || err?.message));
      }
    });
  }

  loadCreditBalance(id: string): void {
    this.creditService.getCustomerCreditBalance(id).subscribe({
      next: (res: any) => {
        this.creditBalance = res.data;
        this.newCreditLimit = this.creditBalance?.credit_limit || null;
      },
      error: (err) => {
        console.error('Failed to load credit balance:', err);
        this.creditBalance = null;
      }
    });
  }

  loadCreditTransactions(id: string): void {
    this.creditService.getCreditTransactionHistory(id, { pageSize: 50 }).subscribe({
      next: (res: any) => {
        this.creditTransactions = res.rows || [];
      },
      error: (err) => {
        console.error('Failed to load credit transactions:', err);
        this.creditTransactions = [];
      }
    });
  }

  updateCreditLimit(): void {
    if (!this.customer?.id || this.newCreditLimit === null) return;
    
    this.updatingCreditLimit = true;
    this.creditService.updateCreditLimit(this.customer.id, this.newCreditLimit).subscribe({
      next: (res: any) => {
        this.creditBalance = res.data;
        this.creditLimitSuccess = true;
        this.updatingCreditLimit = false;
        setTimeout(() => this.creditLimitSuccess = false, 3000);
      },
      error: (err) => {
        console.error('Failed to update credit limit:', err);
        alert('Failed to update credit limit: ' + (err?.error?.error || err?.message));
        this.updatingCreditLimit = false;
      }
    });
  }

  getCreditPercentage(): number {
    if (!this.creditBalance) return 0;
    return (this.creditBalance.credit_used / this.creditBalance.credit_limit) * 100;
  }

  getCreditClass(): string {
    const percent = this.getCreditPercentage();
    if (percent >= 90) return 'danger';
    if (percent >= 75) return 'warning';
    return 'success';
  }

  Math = Math;
}
