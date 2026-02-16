import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CustomerService } from '../../services/customer.service';

@Component({
  selector: 'app-customer-form',
  templateUrl: './customer-form.component.html',
  styleUrls: ['./customer-form.component.css']
})
export class CustomerFormComponent implements OnInit {
  form: FormGroup;
  loading = false;
  error = '';
  customerId: string | null = null;

  customerTypes = ['FLEET', 'WALK_IN', 'INTERNAL', 'WARRANTY'];
  statuses = ['ACTIVE', 'INACTIVE'];
  paymentTerms = ['DUE_ON_RECEIPT', 'NET_15', 'NET_30', 'CUSTOM'];

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private customerService: CustomerService
  ) {
    this.form = this.fb.group({
      company_name: ['', Validators.required],
      customer_type: ['WALK_IN', Validators.required],
      status: ['ACTIVE', Validators.required],
      tax_id: [''],
      primary_contact_name: [''],
      phone: [''],
      email: [''],
      secondary_phone: [''],
      website: [''],
      billing_address_line1: [''],
      billing_address_line2: [''],
      billing_city: [''],
      billing_state: [''],
      billing_zip: [''],
      billing_country: [''],
      payment_terms: ['DUE_ON_RECEIPT', Validators.required],
      payment_terms_custom_days: [null],
      credit_limit: [null],
      tax_exempt: [false],
      billing_notes: [''],
      default_location_id: ['']
    });
  }

  ngOnInit(): void {
    this.customerId = this.route.snapshot.paramMap.get('id');
    if (this.customerId) {
      this.loadCustomer(this.customerId);
    }
  }

  loadCustomer(id: string): void {
    this.loading = true;
    this.customerService.getCustomer(id).subscribe({
      next: (res: any) => {
        const customer = res.customer || res.data?.customer || res.customer;
        if (customer) {
          this.form.patchValue(customer);
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load customer';
        this.loading = false;
      }
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.error = 'Please fill required fields';
      return;
    }

    this.loading = true;
    const payload = this.form.value;

    const request = this.customerId
      ? this.customerService.updateCustomer(this.customerId, payload)
      : this.customerService.createCustomer(payload);

    request.subscribe({
      next: (res: any) => {
        const id = this.customerId || res?.data?.id || res?.customer?.id;
        this.loading = false;
        this.router.navigate(['/customers', id]);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to save customer';
        this.loading = false;
      }
    });
  }

  cancel(): void {
    if (this.customerId) {
      this.router.navigate(['/customers', this.customerId]);
    } else {
      this.router.navigate(['/customers']);
    }
  }
}
