import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ShopClientsService } from '../../services/shop-clients.service';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';

@Component({
  selector: 'app-customer-form',
  templateUrl: './customer-form.component.html',
  styleUrls: ['./customer-form.component.css']
})
export class CustomerFormComponent implements OnInit {
  readonly perms = PERMISSIONS;
  form: FormGroup;
  loading = false;
  error = '';
  success = '';
  customerId: string | null = null;

  customerTypeOptions = [
    { value: 'FLEET', label: 'FLEET' },
    { value: 'WALK_IN', label: 'WALK_IN' },
    { value: 'INTERNAL', label: 'INTERNAL' },
    { value: 'WARRANTY', label: 'WARRANTY' }
  ];
  statusOptions = [
    { value: 'ACTIVE', label: 'ACTIVE' },
    { value: 'INACTIVE', label: 'INACTIVE' }
  ];
  paymentTermsOptions = [
    { value: 'DUE_ON_RECEIPT', label: 'DUE_ON_RECEIPT' },
    { value: 'NET_15', label: 'NET_15' },
    { value: 'NET_30', label: 'NET_30' },
    { value: 'CUSTOM', label: 'CUSTOM' }
  ];

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private customerService: ShopClientsService,
    private permissions: PermissionHelperService
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
        this.error = 'Failed to load shop client';
        this.loading = false;
      }
    });
  }

  save(): void {
    if (!this.canSave()) {
      this.error = this.customerId
        ? 'You do not have permission to edit shop clients.'
        : 'You do not have permission to create shop clients.';
      return;
    }

    if (this.form.invalid) {
      this.error = 'Please fill required fields';
      return;
    }

    this.loading = true;
    this.error = '';
    const payload = this.form.value;

    console.log('Saving shop client:', { id: this.customerId, payload });

    const request = this.customerId
      ? this.customerService.updateCustomer(this.customerId, payload)
      : this.customerService.createCustomer(payload);

    request.subscribe({
      next: (res: any) => {
        console.log('Save response:', res);
        const id = this.customerId || res?.data?.id || res?.customer?.id;
        this.loading = false;
        this.success = this.customerId ? 'Shop client updated successfully' : 'Shop client created successfully';
        setTimeout(() => {
          if (id) {
            this.router.navigate(['/shop-clients', id]);
          } else {
            this.error = 'Shop client saved but could not navigate: missing ID';
          }
        }, 1000);
      },
      error: (err) => {
        console.error('Save error:', err);
        this.error = err?.error?.error || err?.message || 'Failed to save shop client';
        this.loading = false;
      }
    });
  }

  cancel(): void {
    if (this.customerId) {
      this.router.navigate(['/shop-clients', this.customerId]);
    } else {
      this.router.navigate(['/shop-clients']);
    }
  }

  canSave(): boolean {
    if (this.customerId) {
      return this.permissions.hasPermission(PERMISSIONS.CUSTOMERS_EDIT);
    }
    return this.permissions.hasAnyPermission([PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT]);
  }
}
