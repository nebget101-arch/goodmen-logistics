import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ShopClientsService } from '../../services/shop-clients.service';
import { InvoiceService } from '../../services/invoice.service';
import { CreditService } from '../../services/credit.service';
import { ApiService } from '../../services/api.service';
import * as QRCode from 'qrcode';
import { PermissionHelperService } from '../../services/permission-helper.service';
import { PERMISSIONS } from '../../models/access-control.model';

@Component({
  selector: 'app-customer-detail',
  templateUrl: './customer-detail.component.html',
  styleUrls: ['./customer-detail.component.css']
})
export class CustomerDetailComponent implements OnInit, OnDestroy {
  readonly perms = PERMISSIONS;
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

  readonly noteTypeOptions = [
    { value: 'GENERAL', label: 'General' },
    { value: 'BILLING', label: 'Billing' },
    { value: 'SERVICE_ISSUE', label: 'Service Issue' }
  ];

  newVehicle: any = {
    unit_number: '',
    vin: '',
    make: '',
    model: '',
    year: '',
    license_plate: '',
    state: '',
    mileage: ''
  };
  newVehicleError = '';
  newVehicleSuccess = '';
  vinDecodeLoading = false;
  showAddVehicleForm = false;

  vinBridgeMobileUrl = '';
  vinBridgeSessionId = '';
  vinBridgeConnected = false;
  vinBridgeEvents: EventSource | null = null;
  vinQrCodeDataUrl = '';
  vinScanError = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private customerService: ShopClientsService,
    private invoiceService: InvoiceService,
    private creditService: CreditService,
    private fb: FormBuilder,
    private apiService: ApiService,
    private permissions: PermissionHelperService
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

  ngOnDestroy(): void {
    this.stopVinBridge();
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
        this.error = 'Failed to load shop client';
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

  decodeVin(): void {
    const vin = (this.newVehicle.vin || '').trim();
    if (!vin) {
      this.newVehicleError = 'VIN is required to decode.';
      return;
    }
    this.newVehicleError = '';
    this.vinDecodeLoading = true;
    this.apiService.decodeVin(vin).subscribe({
      next: (decoded: any) => {
        this.newVehicle.make = decoded.make || this.newVehicle.make;
        this.newVehicle.model = decoded.model || this.newVehicle.model;
        this.newVehicle.year = decoded.year || this.newVehicle.year;
        this.vinDecodeLoading = false;
      },
      error: () => {
        this.newVehicleError = 'Failed to decode VIN.';
        this.vinDecodeLoading = false;
      }
    });
  }

  addCustomerVehicle(): void {
    if (!this.canCreateCustomerVehicle()) {
      this.newVehicleError = 'You do not have permission to add shop client vehicles.';
      return;
    }
    if (!this.customer?.id) return;
    this.newVehicleError = '';
    this.newVehicleSuccess = '';
    const payload = {
      ...this.newVehicle,
      shop_client_id: this.customer.id
    };
    if (!payload.vin) {
      this.newVehicleError = 'VIN is required.';
      return;
    }
    this.apiService.createCustomerVehicle(payload).subscribe({
      next: () => {
        this.newVehicleSuccess = 'Vehicle added successfully.';
        this.newVehicle = {
          unit_number: '',
          vin: '',
          make: '',
          model: '',
          year: '',
          license_plate: '',
          state: '',
          mileage: ''
        };
        this.loadVehicles(this.customer.id);
        this.stopVinBridge();
        this.showAddVehicleForm = false;
      },
      error: (err) => {
        this.newVehicleError = err?.error?.error || err?.message || 'Failed to add vehicle.';
      }
    });
  }

  startVinBridge(): void {
    this.vinScanError = '';
    this.stopVinBridge();
    this.apiService.createScanBridgeSession().subscribe({
      next: (res: any) => {
        const data = res?.data || {};
        this.vinBridgeMobileUrl = data.mobileUrl || '';
        this.vinBridgeSessionId = data.sessionId || '';
        this.vinQrCodeDataUrl = '';

        if (this.vinBridgeMobileUrl) {
          QRCode.toDataURL(this.vinBridgeMobileUrl, {
            width: 250,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
          }).then((url: string) => {
            this.vinQrCodeDataUrl = url;
          }).catch(() => {
            this.vinQrCodeDataUrl = this.fallbackQrUrl(this.vinBridgeMobileUrl);
            this.vinScanError = 'Failed to generate QR code locally; using fallback.';
          });
        }

        const base = this.apiService.getBaseUrl();
        const eventsUrl = `${base}/scan-bridge/session/${encodeURIComponent(data.sessionId)}/events?readToken=${encodeURIComponent(data.readToken)}`;
        this.vinBridgeEvents = new EventSource(eventsUrl);
        this.vinBridgeEvents.addEventListener('ready', () => {
          this.vinBridgeConnected = true;
        });
        this.vinBridgeEvents.addEventListener('scan', (evt: MessageEvent) => {
          try {
            const payload = JSON.parse(evt.data || '{}');
            const barcode = (payload.barcode || '').toString().trim();
            if (!barcode) return;
            this.newVehicle.vin = barcode;
            this.decodeVin();
          } catch {}
        });
        this.vinBridgeEvents.onerror = () => {
          this.vinBridgeConnected = false;
          this.vinScanError = 'Phone scanner disconnected';
        };
      },
      error: (err: any) => {
        this.vinScanError = err?.error?.error || err?.message || 'Failed to start phone scanner';
      }
    });
  }

  stopVinBridge(): void {
    if (this.vinBridgeEvents) {
      this.vinBridgeEvents.close();
      this.vinBridgeEvents = null;
    }
    this.vinBridgeConnected = false;
    this.vinBridgeMobileUrl = '';
    this.vinBridgeSessionId = '';
    this.vinQrCodeDataUrl = '';
  }

  toggleAddVehicleForm(): void {
    this.showAddVehicleForm = !this.showAddVehicleForm;
    if (!this.showAddVehicleForm) {
      this.stopVinBridge();
      this.newVehicleError = '';
      this.newVehicleSuccess = '';
    }
  }

  private fallbackQrUrl(data: string): string {
    const encoded = encodeURIComponent(data || '');
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encoded}`;
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
    if (!this.canEditCustomer()) {
      this.error = 'You do not have permission to edit shop clients.';
      return;
    }
    if (!this.customer?.id) return;
    this.router.navigate(['/shop-clients', this.customer.id, 'edit']);
  }

  savePricingRules(): void {
    if (!this.canManagePricing()) {
      alert('You do not have permission to update pricing rules.');
      return;
    }
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
    if (!this.canManageCreditLimit()) {
      alert('You do not have permission to update credit limits.');
      return;
    }
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

  canEditCustomer(): boolean {
    return this.permissions.hasPermission(PERMISSIONS.CUSTOMERS_EDIT);
  }

  canCreateCustomerVehicle(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.VEHICLES_CREATE, PERMISSIONS.VEHICLES_EDIT]);
  }

  canManagePricing(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_EDIT, PERMISSIONS.DISCOUNTS_APPROVE]);
  }

  canManageCreditLimit(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.INVOICES_EDIT, PERMISSIONS.ACCESS_ADMIN]);
  }

  Math = Math;
}
