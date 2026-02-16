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
  newCustomer: any = { name: '', dot_number: '', address: '', city: '', state: '', zip: '', phone: '', email: '' };
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

  constructor(private apiService: ApiService, private route: ActivatedRoute) { }

  ngOnInit(): void {
    this.loadVehicles();
    this.loadCustomers();
    this.loadLocations();
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
        if (!data) return;
        this.workOrder.id = data.id;
        this.workOrder.workOrderNumber = data.id;
        this.workOrder.vehicleId = data.vehicleId;
        this.workOrder.customerId = data.customerId;
        this.workOrder.title = data.description || '';
        this.workOrder.type = data.type || 'Repair';
        this.workOrder.status = data.status || 'pending';
        this.workOrder.priority = data.priority || '';
        this.workOrder.requestDate = data.createdAt ? data.createdAt.slice(0, 10) : '';
        this.workOrder.completionDate = data.datePerformed ? data.datePerformed.slice(0, 10) : '';
        this.workOrder.currentOdometer = data.mileage || '';
        this.workOrder.assignedTo = data.mechanicName || '';
        this.workOrder.unitNumber = data.vehicleUnit || '';
        this.workOrder.vin = data.vin || '';
        this.onVehicleSelect();
      },
      error: (err) => {
        this.workOrderSaveError = err?.error?.message || 'Failed to load work order.';
      }
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
      next: (data) => { this.customers = data; },
      error: () => { this.customers = []; }
    });
  }

  searchCustomerByDot(): void {
    this.customerSearchError = '';
    this.selectedCustomer = null;
    if (!this.customerDotSearch) return;
    this.apiService.getCustomerByDot(this.customerDotSearch).subscribe({
      next: (data) => {
        if (data && data.length > 0) {
          this.selectedCustomer = data[0];
          this.workOrder.customerId = data[0].id;
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
            name: company.legal_name || '',
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
    if (!this.newCustomer.name || !this.newCustomer.dot_number) {
      this.newCustomerError = 'Name and DOT number are required.';
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
    const save$ = this.isEditMode && this.workOrderId
      ? this.apiService.updateWorkOrder(this.workOrderId, this.workOrder)
      : this.apiService.createWorkOrder(this.workOrder);

    save$.subscribe({
      next: (saved) => {
        this.workOrder.workOrderNumber = saved?.id || saved?.work_order_id || this.workOrder.workOrderNumber;
        this.workOrderSaveSuccess = this.isEditMode ? 'Work order updated successfully.' : 'Work order saved successfully.';
      },
      error: (err) => {
        this.workOrderSaveError = err?.error?.message || 'Failed to save work order.';
      }
    });
  }
}
