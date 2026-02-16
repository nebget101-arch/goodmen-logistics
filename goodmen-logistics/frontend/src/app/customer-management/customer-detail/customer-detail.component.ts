import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CustomerService } from '../../services/customer.service';

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

  loading = false;
  error = '';
  activeTab: 'overview' | 'work-orders' | 'service-history' | 'pricing' | 'notes' = 'overview';

  notePayload: { note_type: 'GENERAL' | 'BILLING' | 'SERVICE_ISSUE'; note: string } = {
    note_type: 'GENERAL',
    note: ''
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private customerService: CustomerService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.loadCustomer(id);
    this.loadNotes(id);
    this.loadWorkOrders(id);
    this.loadServiceHistory(id);
  }

  loadCustomer(id: string): void {
    this.loading = true;
    this.customerService.getCustomer(id).subscribe({
      next: (res: any) => {
        this.customer = res.customer || res.data?.customer || res.customer;
        this.pricing = res.effectivePricing || res.data?.effectivePricing || res.effectivePricing;
        this.alerts = res.alerts || res.data?.alerts || res.alerts;
        this.loading = false;
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
      }
    });
  }

  loadWorkOrders(id: string): void {
    this.customerService.getWorkOrders(id, { pageSize: 20 }).subscribe({
      next: (res: any) => {
        this.workOrders = res.rows || res.data || [];
      }
    });
  }

  loadServiceHistory(id: string): void {
    this.customerService.getServiceHistory(id, { pageSize: 20 }).subscribe({
      next: (res: any) => {
        this.serviceHistory = res.rows || res.data || [];
      }
    });
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
}
