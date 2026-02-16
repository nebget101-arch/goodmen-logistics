import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-work-order',
  templateUrl: './work-order.component.html',
  styleUrls: ['./work-order.component.css']
})
export class WorkOrderComponent implements OnInit {
  vehicles: any[] = [];
  files: File[] = [];
  customers: any[] = [];
  locations: any[] = [];
  customerDotSearch: string = '';
  customerSearchError: string = '';
  selectedCustomer: any = null;
  showNewCustomerModal = false;
  newCustomer: any = { company_name: '', dot_number: '', address: '', city: '', state: '', zip: '', phone: '', email: '' };
  newCustomerError: string = '';
  workOrder: any = {
    vehicleId: null,
    customerId: null,
    shopLocationId: null,
    parts: [],
    labor: []
  };

  vehicleVinSearch: string = '';
  filteredVehicles: any[] = [];
  showNewCustomerVehicleModal = false;
  newCustomerVehicle: any = { unit_number: '', vin: '', make: '', model: '', year: '', license_plate: '', state: '', mileage: '', inspection_expiry: '', next_pm_due: '', next_pm_mileage: '', customer_id: '' };
  newCustomerVehicleError: string = '';
  newVehicleOwnership: 'company' | 'customer' = 'company';
  workOrderSaveError: string = '';
  workOrderSaveSuccess: string = '';
  isEditMode = false;
  workOrderId: string | null = null;
  documents: any[] = [];
  invoiceInfo: any = null;
  workOrderLoadError: string = '';
  partsCatalog: any[] = [];
  workOrderParts: any[] = [];
  reservePartForm: any = { partId: '', qtyRequested: 1, unitPrice: null, locationId: '' };

  constructor(private apiService: ApiService, private route: ActivatedRoute) { }

  ngOnInit(): void {
    this.loadVehicles();
    this.loadCustomers();
    this.loadLocations();
    this.loadParts();
    this.initWorkOrder();
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.isEditMode = true;
        this.workOrderId = id;
        this.loadWorkOrder(id);
      }
    });
  }

  loadWorkOrder(id: string): void {
    this.apiService.getWorkOrder(id).subscribe({
      next: (data) => {
        const payload = data?.data || data;
        if (!payload) return;

        const wo = payload.workOrder || payload;
        this.workOrder.id = wo.id;
        this.workOrder.workOrderNumber = wo.work_order_number || wo.workOrderNumber || wo.id;
        this.workOrder.vehicleId = wo.vehicle_id || wo.vehicleId;
        this.workOrder.customerId = wo.customer_id || wo.customerId;
        this.workOrder.shopLocationId = wo.location_id || wo.locationId;
        this.workOrder.title = wo.description || '';
        this.workOrder.type = wo.type || 'REPAIR';
        this.workOrder.status = wo.status || 'DRAFT';
        this.workOrder.priority = wo.priority || '';
        this.workOrder.requestDate = wo.created_at ? wo.created_at.slice(0, 10) : '';
        this.workOrder.completionDate = wo.completed_at ? wo.completed_at.slice(0, 10) : '';
        this.workOrder.currentOdometer = wo.odometer_miles || '';
        this.workOrder.assignedTo = wo.assigned_mechanic_user_id || '';

        const vehicle = payload.vehicle || {};
        this.workOrder.unitNumber = vehicle.unit_number || wo.vehicle_unit || '';
        this.workOrder.vin = vehicle.vin || wo.vehicle_vin || '';
        this.onVehicleSelect();

        this.documents = payload.documents || [];
        this.invoiceInfo = (payload.invoices && payload.invoices.length) ? payload.invoices[0] : null;
        this.workOrderParts = payload.parts || [];
        this.reservePartForm.locationId = this.workOrder.shopLocationId || '';
      },
      error: (err) => {
        this.workOrderLoadError = err?.error?.error || err?.error?.message || 'Failed to load work order.';
      }
    });
  }

  loadParts(): void {
    this.apiService.getParts({ pageSize: 500 }).subscribe({
      next: (res: any) => {
        this.partsCatalog = res?.rows || res?.data || res || [];
      },
      error: () => { this.partsCatalog = []; }
    });
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data; },
      error: () => { this.locations = []; }
    });
  }

  loadCustomers(): void {
    this.apiService.getCustomers().subscribe({
      next: (data) => {
        this.customers = data?.rows || data?.data || data || [];
      },
      error: () => { this.customers = []; }
    });
  }

  searchCustomerByDot(): void {
    this.customerSearchError = '';
    this.selectedCustomer = null;
    if (!this.customerDotSearch) return;
    this.apiService.getCustomerByDot(this.customerDotSearch).subscribe({
      next: (data) => {
        const rows = data?.rows || data?.data || data || [];
        if (rows && rows.length > 0) {
          this.selectedCustomer = rows[0];
          this.workOrder.customerId = rows[0].id;
        } else {
          this.fetchFmcsadot(this.customerDotSearch);
        }
      },
      error: () => { this.customerSearchError = 'Error searching customer.'; }
    });
  }

  fetchFmcsadot(dot: string): void {
    this.apiService.getFmcsainfo(dot).subscribe({
      next: (company) => {
        if (company) {
          this.newCustomer = {
            company_name: company.legal_name || company.name || '',
            dot_number: dot,
            address: company.address || '',
            city: company.city || '',
            state: company.state || '',
            zip: company.zip || '',
            phone: company.phone || '',
            email: ''
          };
          this.showNewCustomerModal = true;
        } else {
          this.customerSearchError = 'No customer found for this DOT number.';
        }
      },
      error: () => { this.customerSearchError = 'FMCSA lookup failed or unavailable.'; }
    });
  }

  createCustomer(): void {
    this.newCustomerError = '';
    if (!this.newCustomer.company_name || !this.newCustomer.dot_number) {
      this.newCustomerError = 'Company name and DOT number are required.';
      return;
    }
    this.apiService.createCustomer(this.newCustomer).subscribe({
      next: (customer) => {
        this.customers.push(customer);
        this.workOrder.customerId = customer.id;
        this.selectedCustomer = customer;
        this.showNewCustomerModal = false;
        this.newCustomer = { name: '', dot_number: '', address: '', city: '', state: '', zip: '', phone: '', email: '' };
      },
      error: () => {
        this.newCustomerError = 'Failed to create customer.';
      }
    });
  }

  loadVehicles(): void {
    this.apiService.getVehicles().subscribe({
      next: (data) => {
        this.vehicles = data;
        this.filteredVehicles = data;
      },
      error: () => {
        this.vehicles = [];
        this.filteredVehicles = [];
      }
    });
  }

  initWorkOrder(): void {
    this.workOrder = {
      vehicleId: null,
      customerId: null,
      shopLocationId: null,
      unitNumber: '',
      vin: '',
      licensePlate: '',
      make: '',
      model: '',
      year: '',
      vehicleType: '',
      currentOdometer: '',
      engineHours: '',
      fleetTerminal: '',
      driverAssigned: '',
      vehicleStatus: '',
      parts: [],
      labor: []
    };
  }

  openAddVehicleModal(): void {
    this.newCustomerVehicleError = '';
    this.newVehicleOwnership = this.workOrder.customerId ? 'customer' : 'company';
    this.newCustomerVehicle = {
      unit_number: '',
      vin: '',
      make: '',
      model: '',
      year: '',
      license_plate: '',
      state: '',
      mileage: '',
      inspection_expiry: '',
      next_pm_due: '',
      next_pm_mileage: '',
      customer_id: this.workOrder.customerId || ''
    };
    this.showNewCustomerVehicleModal = true;
  }

  onVehicleVinSearchChange(): void {
    const search = this.vehicleVinSearch.trim();
    if (search.length < 1) {
      this.filteredVehicles = this.vehicles;
      this.showNewCustomerVehicleModal = false;
      return;
    }
    this.apiService.getVehiclesByVin(search).subscribe({
      next: (data) => {
        this.filteredVehicles = data;
        if (this.filteredVehicles.length === 0) {
          this.showNewCustomerVehicleModal = true;
          this.newVehicleOwnership = this.workOrder.customerId ? 'customer' : 'company';
          this.newCustomerVehicle = {
            unit_number: '',
            vin: search,
            make: '',
            model: '',
            year: '',
            license_plate: '',
            state: '',
            mileage: '',
            inspection_expiry: '',
            next_pm_due: '',
            next_pm_mileage: '',
            customer_id: this.workOrder.customerId || ''
          };
        } else {
          this.showNewCustomerVehicleModal = false;
        }
      },
      error: () => {
        this.filteredVehicles = [];
        this.showNewCustomerVehicleModal = true;
        this.newVehicleOwnership = this.workOrder.customerId ? 'customer' : 'company';
        this.newCustomerVehicle = {
          unit_number: '',
          vin: search,
          make: '',
          model: '',
          year: '',
          license_plate: '',
          state: '',
          mileage: '',
          inspection_expiry: '',
          next_pm_due: '',
          next_pm_mileage: '',
          insurance_expiry: '',
          registration_expiry: '',
          customer_id: this.workOrder.customerId || ''
        };
      }
    });
  }

  decodeVinForNewVehicle(): void {
    const vin = (this.newCustomerVehicle.vin || '').trim();
    if (!vin) {
      this.newCustomerVehicleError = 'VIN is required to decode.';
      return;
    }
    this.newCustomerVehicleError = '';
    this.apiService.decodeVin(vin).subscribe({
      next: (decoded) => {
        this.newCustomerVehicle.make = decoded.make || this.newCustomerVehicle.make;
        this.newCustomerVehicle.model = decoded.model || this.newCustomerVehicle.model;
        this.newCustomerVehicle.year = decoded.year || this.newCustomerVehicle.year;
      },
      error: () => {
        this.newCustomerVehicleError = 'Failed to decode VIN.';
      }
    });
  }

  createVehicleFromWorkOrder(): void {
    this.newCustomerVehicleError = '';
    if (!this.newCustomerVehicle.vin) {
      this.newCustomerVehicleError = 'VIN is required.';
      return;
    }
    if (this.newVehicleOwnership === 'customer') {
      if (!this.newCustomerVehicle.customer_id) {
        this.newCustomerVehicleError = 'Customer is required for customer-owned vehicles.';
        return;
      }
      this.apiService.createCustomerVehicle(this.newCustomerVehicle).subscribe({
        next: (vehicle) => {
          vehicle.company_owned = false;
          this.vehicles.push(vehicle);
          this.filteredVehicles = [vehicle];
          this.workOrder.vehicleId = vehicle.id;
          this.showNewCustomerVehicleModal = false;
        },
        error: () => {
          this.newCustomerVehicleError = 'Failed to create customer vehicle.';
        }
      });
      return;
    }

    const companyVehicle = { ...this.newCustomerVehicle };
    delete companyVehicle.customer_id;
    this.apiService.createVehicle(companyVehicle).subscribe({
      next: (vehicle) => {
        vehicle.company_owned = true;
        this.vehicles.push(vehicle);
        this.filteredVehicles = [vehicle];
        this.workOrder.vehicleId = vehicle.id;
        this.showNewCustomerVehicleModal = false;
      },
      error: () => {
        this.newCustomerVehicleError = 'Failed to create company vehicle.';
      }
    });
  }

  onVehicleSelect(): void {
    const selectedId = this.workOrder.vehicleId;
    // Search in filteredVehicles first (when using search), then fall back to all vehicles
    let vehicle = this.filteredVehicles.find(v => String(v.id) === String(selectedId));
    if (!vehicle) {
      vehicle = this.vehicles.find(v => String(v.id) === String(selectedId));
    }

    if (vehicle) {
      const vinValue = vehicle.vin || '';
      const vinFallback = vinValue ? vinValue.slice(-4) : '';
      this.workOrder.unitNumber = vehicle.unit_number || vehicle.unitNumber || vinFallback;
      this.workOrder.vin = vehicle.vin;
      this.workOrder.licensePlate = vehicle.license_plate || vehicle.licensePlate;
      this.workOrder.make = vehicle.make;
      this.workOrder.model = vehicle.model;
      this.workOrder.year = vehicle.year;
      this.workOrder.vehicleType = vehicle.type || '';
      this.workOrder.currentOdometer = vehicle.mileage;
      this.workOrder.engineHours = vehicle.engineHours || '';
      this.workOrder.fleetTerminal = vehicle.state;
      this.workOrder.driverAssigned = vehicle.driverName || '';
      this.workOrder.vehicleStatus = vehicle.status;
    }
  }

  addPart(): void {
    this.workOrder.parts.push({});
  }

  removePart(index: number): void {
    this.workOrder.parts.splice(index, 1);
  }

  addLabor(): void {
    this.workOrder.labor.push({});
  }

  removeLabor(index: number): void {
    this.workOrder.labor.splice(index, 1);
  }

  onFileChange(event: any): void {
    this.files = Array.from(event.target.files);
  }

  submitWorkOrder(): void {
    this.workOrderSaveError = '';
    this.workOrderSaveSuccess = '';
    const payload: any = {
      vehicleId: this.workOrder.vehicleId,
      customerId: this.workOrder.customerId,
      locationId: this.workOrder.shopLocationId,
      type: this.workOrder.type,
      priority: this.workOrder.priority,
      status: this.workOrder.status,
      description: this.workOrder.title,
      odometerMiles: this.workOrder.currentOdometer,
      assignedMechanicUserId: this.workOrder.assignedTo,
      labor: this.workOrder.labor || [],
      fees: this.workOrder.fees || [],
      discountType: this.workOrder.discountType,
      discountValue: this.workOrder.discountValue,
      taxRatePercent: this.workOrder.taxRatePercent
    };

    const save$ = this.isEditMode && this.workOrderId
      ? this.apiService.updateWorkOrder(this.workOrderId, payload)
      : this.apiService.createWorkOrder(payload);

    save$.subscribe({
      next: (saved) => {
        const savedData = saved?.data || saved;
        this.workOrder.workOrderNumber = savedData?.work_order_number || savedData?.id || this.workOrder.workOrderNumber;
        this.workOrderSaveSuccess = this.isEditMode ? 'Work order updated successfully.' : 'Work order saved successfully.';
      },
      error: (err) => {
        this.workOrderSaveError = err?.error?.message || 'Failed to save work order.';
      }
    });
  }

  generateInvoice(): void {
    if (!this.workOrderId) return;
    this.apiService.generateInvoiceFromWorkOrder(this.workOrderId).subscribe({
      next: (res: any) => {
        this.invoiceInfo = res?.data || res;
      }
    });
  }

  uploadDocument(event: any): void {
    const file = event.target.files?.[0];
    if (!file || !this.workOrderId) return;
    this.apiService.uploadWorkOrderDocument(this.workOrderId, file).subscribe({
      next: () => this.loadWorkOrder(this.workOrderId as string)
    });
  }

  canGenerateInvoice(): boolean {
    const status = (this.workOrder?.status || '').toString().toUpperCase();
    return status === 'COMPLETED';
  }

  reservePart(): void {
    if (!this.workOrderId) return;
    const payload = {
      partId: this.reservePartForm.partId,
      qtyRequested: this.reservePartForm.qtyRequested,
      unitPrice: this.reservePartForm.unitPrice,
      locationId: this.reservePartForm.locationId || this.workOrder.shopLocationId
    };
    this.apiService.reserveWorkOrderPart(this.workOrderId, payload).subscribe({
      next: () => {
        this.reservePartForm = { partId: '', qtyRequested: 1, unitPrice: null, locationId: this.workOrder.shopLocationId || '' };
        this.loadWorkOrder(this.workOrderId as string);
      }
    });
  }

  issuePart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    const qtyStr = prompt('Qty to issue:', '1');
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    this.apiService.issueWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => this.loadWorkOrder(this.workOrderId as string)
    });
  }

  returnPart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    const qtyStr = prompt('Qty to return:', '1');
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    this.apiService.returnWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => this.loadWorkOrder(this.workOrderId as string)
    });
  }
}
