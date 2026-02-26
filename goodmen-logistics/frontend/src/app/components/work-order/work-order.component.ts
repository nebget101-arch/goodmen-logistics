import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { CreditService } from '../../services/credit.service';

@Component({
  selector: 'app-work-order',
  templateUrl: './work-order.component.html',
  styleUrls: ['./work-order.component.css']
})
export class WorkOrderComponent implements OnInit {
  private readonly partsTaxRate = 8.5;
  vehicles: any[] = [];
  files: File[] = [];
  customers: any[] = [];
  filteredCustomers: any[] = [];
  showCustomerDropdown = false;
  locations: any[] = [];
  customerDotSearch: string = '';
  customerSearch: string = '';
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
  vehicleSearch: string = '';
  showVehicleDropdown = false;
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
  filteredParts: any[] = [];
  partSearch: string = '';
  showPartDropdown = false;
  technicians: any[] = [];
  activeMechanicIndex: number | null = null;
  workOrderParts: any[] = [];
  reservePartForm: any = { partId: '', qtyRequested: 1, unitPrice: null, locationId: '' };

  // Credit management
  availableCredit: number = 0;
  customerCreditLimit: number = 0;
  useCustomerCredit: boolean = false;
  creditCheckLoading: boolean = false;
  creditCheckError: string = '';

  constructor(private apiService: ApiService, private route: ActivatedRoute, private creditService: CreditService) { }

  ngOnInit(): void {
    this.loadVehicles();
    this.loadCustomers();
    this.loadLocations();
    this.loadParts();
    this.loadTechnicians();
    this.initWorkOrder();
    this.setRequestedByFromCurrentUser();
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
        this.workOrder.workOrderNumber = wo.work_order_number || wo.workOrderNumber || '';
        this.workOrder.vehicleId = wo.vehicle_id || wo.vehicleId;
        this.workOrder.customerId = wo.customer_id || wo.customerId;
        console.log('[loadWorkOrder] Set customerId to:', this.workOrder.customerId);
        this.workOrder.shopLocationId = wo.location_id || wo.locationId;
        this.workOrder.title = wo.description || '';
        this.workOrder.type = wo.type || 'REPAIR';
        this.workOrder.status = this.normalizeStatusForSelect(wo.status || 'DRAFT');
        this.workOrder.priority = wo.priority || '';
        this.workOrder.requestDate = wo.created_at ? wo.created_at.slice(0, 10) : '';
        this.workOrder.completionDate = wo.completed_at ? wo.completed_at.slice(0, 10) : '';
        this.workOrder.currentOdometer = wo.odometer_miles || '';
        this.workOrder.assignedTo = wo.assigned_mechanic_user_id || '';
        const requestedByName = payload.requestedBy?.username
          || (payload.requestedBy?.first_name && payload.requestedBy?.last_name
            ? `${payload.requestedBy.first_name}.${payload.requestedBy.last_name}`.toLowerCase()
            : '')
          || wo.requested_by_username
          || wo.requestedBy
          || this.workOrder.requestedBy
          || '';
        this.workOrder.requestedBy = this.isLikelyUuid(requestedByName) ? '' : requestedByName;
        if (!this.workOrder.requestedBy) {
          this.setRequestedByFromCurrentUser();
        }

        const vehicle = payload.vehicle || {};
        this.workOrder.unitNumber = vehicle.unit_number || wo.vehicle_unit || '';
        this.workOrder.vin = vehicle.vin || wo.vehicle_vin || '';
        
        // Set vehicle search field
        if (this.workOrder.vehicleId && this.workOrder.unitNumber) {
          this.vehicleSearch = `${this.workOrder.unitNumber} - ${this.workOrder.vin || ''}`;
        }
        
        this.onVehicleSelect();

        this.documents = payload.documents || [];
        this.invoiceInfo = (payload.invoices && payload.invoices.length) ? payload.invoices[0] : null;
        this.workOrderParts = payload.parts || [];
        if (Array.isArray(payload.labor) && payload.labor.length) {
          this.workOrder.labor = payload.labor.map((line: any) => ({
            ...line,
            mechanicName: line.mechanicName || line.mechanic_username || '',
            rate: line.rate ?? line.labor_rate ?? '',
            cost: line.cost ?? line.line_total ?? ''
          }));
          this.updateAssignedToFromLabor();
        } else {
          this.workOrder.labor = [];
        }
        this.computeFinancials();
        this.populateUserDisplay(wo, this.workOrder.labor);
        if (!this.workOrder.requestedBy) {
          this.setRequestedByFromCurrentUser();
        }
        this.reservePartForm.locationId = this.workOrder.shopLocationId || '';
        
        // Ensure customer display is populated (handles case where customers load after work order)
        // Use setTimeout to ensure change detection completes
        setTimeout(() => {
          this.populateCustomerDisplay();
          // Check customer credit when loading existing WO
          if (this.workOrder.customerId) {
            this.checkCustomerCredit(this.workOrder.customerId);
          }
        }, 0);
      },
      error: (err) => {
        this.workOrderLoadError = err?.error?.error || err?.error?.message || 'Failed to load work order.';
      }
    });
  }

  loadParts(): void {
    this.apiService.getParts({ pageSize: 10000 }).subscribe({
      next: (res: any) => {
        this.partsCatalog = res?.rows || res?.data || res || [];
        this.filteredParts = [];
      },
      error: () => { this.partsCatalog = []; this.filteredParts = []; }
    });
  }

  loadTechnicians(): void {
    this.apiService.getTechnicians().subscribe({
      next: (res: any) => {
        this.technicians = res?.rows || res?.data || res || [];
      },
      error: () => { this.technicians = []; }
    });
  }

  onPartSearchChange(): void {
    if (!this.partSearch) {
      this.filteredParts = [];
      this.showPartDropdown = false;
      return;
    }
    const search = this.partSearch.toLowerCase();
    this.filteredParts = this.partsCatalog.filter(p => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const partNumber = (p.part_number || '').toLowerCase();
      return sku.includes(search) || name.includes(search) || partNumber.includes(search);
    }).slice(0, 50); // Limit to 50 results for performance
    this.showPartDropdown = this.filteredParts.length > 0;
  }

  selectPart(part: any): void {
    this.reservePartForm.partId = part.id;
    this.partSearch = `${part.sku} - ${part.name}`;
    this.showPartDropdown = false;
    this.onReservePartChange();
  }

  onPartBlur(): void {
    setTimeout(() => {
      this.showPartDropdown = false;
    }, 200);
  }

  onPartHover(event: any, isEnter: boolean): void {
    const element = event?.target as HTMLElement;
    if (element) {
      element.style.backgroundColor = isEnter ? '#f5f5f5' : 'white';
    }
  }

  loadLocations(): void {
    this.apiService.getLocations().subscribe({
      next: (data) => { this.locations = data; },
      error: () => { this.locations = []; }
    });
  }

  loadCustomers(): void {
    // Load all customers with large page size
    this.apiService.getCustomers({ pageSize: 5000 }).subscribe({
      next: (data) => {
        const rows = data?.rows || data?.data || data || [];
        this.customers = rows.map((c: any) => ({
          ...c,
          company_name: c.company_name || c.companyName || c.name || '',
          displayName: c.company_name || c.companyName || c.name || ''
        }));
        this.filteredCustomers = [...this.customers];
        
        // Populate customer display if work order was already loaded
        setTimeout(() => this.populateCustomerDisplay(), 0);
      },
      error: () => { this.customers = []; this.filteredCustomers = []; }
    });
  }

  populateCustomerDisplay(): void {
    console.log('[populateCustomerDisplay] customerId:', this.workOrder.customerId, 'customers.length:', this.customers.length);
    if (this.workOrder.customerId && this.customers.length > 0) {
      // Log the first few customer IDs to see the format
      console.log('[populateCustomerDisplay] First 3 customer IDs:', this.customers.slice(0, 3).map(c => ({ id: c.id, name: c.company_name || c.name })));
      
      const customer = this.customers.find(c => c.id === this.workOrder.customerId);
      console.log('[populateCustomerDisplay] found customer:', customer);
      
      // Try to find with string comparison
      if (!customer) {
        const customerByString = this.customers.find(c => String(c.id) === String(this.workOrder.customerId));
        console.log('[populateCustomerDisplay] found by string comparison:', customerByString);
        if (customerByString) {
          const displayName = customerByString.displayName || customerByString.company_name || customerByString.name || '';
          this.customerSearch = displayName;
          this.selectedCustomer = customerByString;
          console.log('[populateCustomerDisplay] Updated customerSearch to:', this.customerSearch);
          return;
        }
        
        // If still not found, fetch the specific customer
        console.log('[populateCustomerDisplay] Customer not in list, fetching from API...');
        this.apiService.getCustomers({ pageSize: 5000 }).subscribe({
          next: (data: any) => {
            const allCustomers = data?.rows || data?.data || data || [];
            const fetchedCustomer = allCustomers.find((c: any) => c.id === this.workOrder.customerId);
            if (fetchedCustomer) {
              const mappedCustomer = {
                ...fetchedCustomer,
                company_name: fetchedCustomer.company_name || fetchedCustomer.companyName || fetchedCustomer.name || '',
                displayName: fetchedCustomer.company_name || fetchedCustomer.companyName || fetchedCustomer.name || ''
              };
              // Add to customers list
              this.customers.push(mappedCustomer);
              this.customerSearch = mappedCustomer.displayName;
              this.selectedCustomer = mappedCustomer;
              console.log('[populateCustomerDisplay] Fetched and set customer:', mappedCustomer.displayName);
            } else {
              console.error('[populateCustomerDisplay] Customer not found in full list either');
            }
          },
          error: (err: any) => {
            console.error('[populateCustomerDisplay] Failed to fetch customers:', err);
          }
        });
        return;
      }
      
      if (customer) {
        const displayName = customer.displayName || customer.company_name || customer.name || '';
        console.log('[populateCustomerDisplay] displayName:', displayName, 'current customerSearch:', this.customerSearch);
        // Only update if different or empty
        if (!this.customerSearch || this.customerSearch !== displayName) {
          this.customerSearch = displayName;
          this.selectedCustomer = customer;
          console.log('[populateCustomerDisplay] Updated customerSearch to:', this.customerSearch);
        }
      }
    }
  }

  onCustomerSearchChange(): void {
    if (!this.customerSearch) {
      this.filteredCustomers = [];
      this.showCustomerDropdown = false;
      return;
    }
    const search = this.customerSearch.toLowerCase();
    this.filteredCustomers = this.customers.filter(c => {
      const name = (c.displayName || c.company_name || c.name || '').toLowerCase();
      const dot = (c.dot_number || '').toLowerCase();
      return name.includes(search) || dot.includes(search);
    });
    this.showCustomerDropdown = this.filteredCustomers.length > 0;
  }

  selectCustomer(customer: any): void {
    this.workOrder.customerId = customer.id;
    this.customerSearch = customer.displayName || customer.company_name || customer.name;
    this.showCustomerDropdown = false;
    
    // Check credit availability for this customer
    this.checkCustomerCredit(customer.id);
  }

  onCustomerBlur(): void {
    // Hide dropdown after a short delay to allow click selection
    setTimeout(() => {
      this.showCustomerDropdown = false;
    }, 200);
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
        this.filteredVehicles = [];
      },
      error: () => {
        this.vehicles = [];
        this.filteredVehicles = [];
      }
    });
  }

  onVehicleSearchChange(): void {
    if (!this.vehicleSearch) {
      this.filteredVehicles = [];
      this.showVehicleDropdown = false;
      return;
    }
    const search = this.vehicleSearch.toLowerCase();
    this.filteredVehicles = this.vehicles.filter(v => {
      const unit = (v.unit_number || v.unitNumber || '').toLowerCase();
      const vin = (v.vin || '').toLowerCase();
      const make = (v.make || '').toLowerCase();
      const model = (v.model || '').toLowerCase();
      return unit.includes(search) || vin.includes(search) || make.includes(search) || model.includes(search);
    });
    this.showVehicleDropdown = this.filteredVehicles.length > 0;
  }

  selectVehicle(vehicle: any): void {
    this.workOrder.vehicleId = vehicle.id;
    const ownership = vehicle.source === 'customer' || vehicle.company_owned === false ? 'Customer' : 'Internal';
    this.vehicleSearch = `${vehicle.unit_number || vehicle.unitNumber} - ${vehicle.vin} (${ownership})`;
    this.showVehicleDropdown = false;
    this.onVehicleSelect();
  }

  onVehicleBlur(): void {
    setTimeout(() => {
      this.showVehicleDropdown = false;
    }, 200);
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

      // Auto-assign customer based on vehicle ownership
      const isCompanyOwned = vehicle.source === 'internal' || vehicle.is_company_owned === true || vehicle.company_owned === true;
      
      if (isCompanyOwned) {
        // Find and assign Internal customer
        const internalCustomer = this.customers.find(c => c.name === 'Internal' || c.company_name === 'Internal');
        if (internalCustomer) {
          this.workOrder.customerId = internalCustomer.id;
          this.customerSearch = internalCustomer.displayName || internalCustomer.company_name || 'Internal';
          this.selectedCustomer = internalCustomer;
        }
      } else if (vehicle.customer_id) {
        // Assign to the vehicle's customer
        this.workOrder.customerId = vehicle.customer_id;
        const customer = this.customers.find(c => c.id === vehicle.customer_id);
        if (customer) {
          this.customerSearch = customer.displayName || customer.company_name || customer.name;
          this.selectedCustomer = customer;
        }
      }
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
    this.updateAssignedToFromLabor();
  }

  removeLabor(index: number): void {
    this.workOrder.labor.splice(index, 1);
    this.updateAssignedToFromLabor();
  }

  onPartLookup(index: number, lookupValue: string): void {
    const selected = this.findPartByLookup(lookupValue);
    if (!selected) return;

    const part = this.workOrder.parts[index] || {};
    part.partId = selected.id;
    part.partName = selected.name;
    part.partNumber = selected.sku;
    part.quantity = part.quantity ?? 1;
    part.unitCost = selected.unit_cost ?? selected.unit_price ?? part.unitCost;
    this.updatePartTotals(index);
    this.workOrder.parts[index] = part;
  }

  onMechanicLookup(index: number, lookupValue: string): void {
    if (!lookupValue) return;
    const normalized = lookupValue.trim().toLowerCase();
    const tech = this.technicians.find(t => (t.username || '').toLowerCase() === normalized);
    if (!tech) return;

    const labor = this.workOrder.labor[index] || {};
    labor.mechanicId = tech.id;
    labor.mechanicName = tech.username;
    this.workOrder.labor[index] = labor;
    this.updateAssignedToFromLabor();
  }

  filterTechnicians(query: string | null | undefined): any[] {
    if (!query) return this.technicians;
    const normalized = query.trim().toLowerCase();
    return this.technicians.filter(t => (t.username || '').toLowerCase().includes(normalized));
  }

  showTechnicianDropdown(index: number, show: boolean): void {
    if (show) {
      this.activeMechanicIndex = index;
    } else if (this.activeMechanicIndex === index) {
      this.activeMechanicIndex = null;
    }
  }

  selectTechnician(index: number, tech: any): void {
    const labor = this.workOrder.labor[index] || {};
    labor.mechanicId = tech.id;
    labor.mechanicName = tech.username;
    this.workOrder.labor[index] = labor;
    this.activeMechanicIndex = null;
    this.updateAssignedToFromLabor();
  }

  updateAssignedToFromLabor(): void {
    const names = (this.workOrder.labor || [])
      .map((line: any) => (line?.mechanicName || '').trim())
      .filter((name: string) => name.length > 0);
    const unique = Array.from(new Set(names));
    this.workOrder.assignedTo = unique.join(', ');
  }

  getPrimaryMechanicId(): string | null {
    const first = (this.workOrder.labor || []).find((line: any) => !!line?.mechanicId);
    return first?.mechanicId || null;
  }

  setRequestedByFromCurrentUser(): void {
    if (this.workOrder?.requestedBy) return;
    const displayName = localStorage.getItem('displayName');
    const username = localStorage.getItem('username');
    const safeDisplay = displayName && !this.isLikelyUuid(displayName) ? displayName : '';
    const safeUsername = username && !this.isLikelyUuid(username) ? username : '';
    if (safeDisplay || safeUsername) {
      this.workOrder.requestedBy = safeDisplay || safeUsername || '';
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1] || ''));
      const tokenUsername = payload?.username || '';
      if (tokenUsername && !this.isLikelyUuid(tokenUsername)) {
        this.workOrder.requestedBy = tokenUsername;
        localStorage.setItem('username', tokenUsername);
      }
    } catch {
      // ignore token parse errors
    }
  }

  private normalizeStatusForSelect(status: string): string {
    const value = (status || '').toString().trim();
    if (!value) return 'DRAFT';
    if (value.includes('_')) return value.toUpperCase();
      return value.replace(/[\s-]+/g, '_').toUpperCase();
  }

  private populateUserDisplay(workOrder: any, laborLines: any[]): void {
    const requestedById = workOrder?.requested_by_user_id;
    if (requestedById && !this.workOrder.requestedBy) {
      this.apiService.getUserById(requestedById).subscribe({
        next: (res: any) => {
          const user = res?.data || res;
          const display = this.formatUserDisplay(user);
          if (display) {
            this.workOrder.requestedBy = display;
          }
        }
      });
    }

    const ids = new Set<string>();
    const assignedId = workOrder?.assigned_mechanic_user_id;
    if (assignedId) ids.add(assignedId);
    (laborLines || []).forEach(line => {
      if (line?.mechanic_user_id) ids.add(line.mechanic_user_id);
    });

    ids.forEach(id => {
      this.apiService.getUserById(id).subscribe({
        next: (res: any) => {
          const user = res?.data || res;
          const display = this.formatUserDisplay(user);
          if (!display) return;

          (this.workOrder.labor || []).forEach((line: any) => {
            const matchesLine = line.mechanic_user_id && String(line.mechanic_user_id) === String(user.id);
            const useAssigned = !line.mechanic_user_id && assignedId && String(user.id) === String(assignedId);
            if (!line.mechanicName && (matchesLine || useAssigned)) {
              line.mechanicName = display;
            }
          });

          this.updateAssignedToFromLabor();
          if (!this.workOrder.assignedTo && assignedId && String(user.id) === String(assignedId)) {
            this.workOrder.assignedTo = display;
          }
        }
      });
    });
  }

  private formatUserDisplay(user: any): string {
    if (!user) return '';
    if (user.username) return user.username;
    if (user.first_name && user.last_name) {
      return `${user.first_name}.${user.last_name}`.toLowerCase();
    }
    return user.email || '';
  }

  private computeFinancials(): void {
    const laborSubtotal = (this.workOrder.labor || []).reduce((sum: number, line: any) => {
      return sum + (Number(line.cost) || Number(line.line_total) || 0);
    }, 0);

    const partsSubtotal = (this.workOrderParts || []).reduce((sum: number, line: any) => {
      const lineTotal = Number(line.line_total);
      if (!Number.isNaN(lineTotal) && lineTotal > 0) return sum + lineTotal;
      const issued = Number(line.qty_issued) || 0;
      const unitPrice = Number(line.unit_price) || 0;
      return sum + (issued * unitPrice);
    }, 0);

    const taxAmount = partsSubtotal * (this.partsTaxRate / 100);
    const actualCost = laborSubtotal + partsSubtotal;
    this.workOrder.actualCost = Number(actualCost.toFixed(2));
    this.workOrder.tax = Number(taxAmount.toFixed(2));
    this.workOrder.totalCost = Number((actualCost + taxAmount).toFixed(2));
    this.workOrder.taxRatePercent = this.partsTaxRate;
  }

  private isLikelyUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((value || '').trim());
  }

  onReservePartChange(): void {
    const selected = this.partsCatalog.find(p => String(p.id) === String(this.reservePartForm.partId));
    if (!selected) return;
    if (this.reservePartForm.unitPrice === null || this.reservePartForm.unitPrice === undefined || this.reservePartForm.unitPrice === '') {
      this.reservePartForm.unitPrice = selected.unit_cost ?? selected.unit_price ?? this.reservePartForm.unitPrice;
    }
  }

  updatePartTotals(index: number): void {
    const part = this.workOrder.parts[index];
    if (!part) return;
    const qty = Number(part.quantity) || 0;
    const unitCost = Number(part.unitCost) || 0;
    part.totalCost = qty * unitCost;
    this.workOrder.parts[index] = part;
    this.computeFinancials();
  }

  updateLaborTotals(index: number): void {
    const labor = this.workOrder.labor[index];
    if (!labor) return;
    const hours = Number(labor.hours) || 0;
    const rate = Number(labor.rate) || 0;
    labor.cost = hours * rate;
    this.workOrder.labor[index] = labor;
    this.computeFinancials();
  }

  private findPartByLookup(lookupValue: string): any | null {
    if (!lookupValue) return null;
    const normalized = lookupValue.trim().toLowerCase();
    return this.partsCatalog.find(p => {
      const sku = (p.sku || '').toLowerCase();
      const name = (p.name || '').toLowerCase();
      const combined = `${p.sku || ''} - ${p.name || ''}`.toLowerCase();
      return sku === normalized || name === normalized || combined === normalized;
    }) || null;
  }

  onFileChange(event: any): void {
    this.files = Array.from(event.target.files);
  }

  submitWorkOrder(): void {
    this.workOrderSaveError = '';
    this.workOrderSaveSuccess = '';
    this.setRequestedByFromCurrentUser();
    this.computeFinancials();
    const laborLines = (this.workOrder.labor || []).map((line: any) => {
      if (line?.mechanicId) return line;
      const name = (line?.mechanicName || '').trim().toLowerCase();
      if (!name) return line;
      const tech = this.technicians.find(t => (t.username || '').toLowerCase() === name);
      return tech ? { ...line, mechanicId: tech.id } : line;
    });
    const payload: any = {
      vehicleId: this.workOrder.vehicleId,
      customerId: this.workOrder.customerId,
      locationId: this.workOrder.shopLocationId,
      type: this.workOrder.type,
      priority: this.workOrder.priority,
      status: this.workOrder.status,
      description: this.workOrder.title,
      odometerMiles: this.workOrder.currentOdometer,
      assignedMechanicUserId: this.getPrimaryMechanicId(),
      requestedBy: this.workOrder.requestedBy,
      labor: laborLines,
      fees: this.workOrder.fees || [],
      discountType: this.workOrder.discountType,
      discountValue: this.workOrder.discountValue,
      taxRatePercent: this.workOrder.taxRatePercent ?? this.partsTaxRate
    };

    const save$ = this.isEditMode && this.workOrderId
      ? this.apiService.updateWorkOrder(this.workOrderId, payload)
      : this.apiService.createWorkOrder(payload);

    save$.subscribe({
      next: (saved) => {
        const savedData = saved?.data || saved;
        const workOrderId = savedData?.id || this.workOrderId;
        this.workOrder.workOrderNumber = savedData?.work_order_number || savedData?.id || this.workOrder.workOrderNumber;
        this.workOrderSaveSuccess = this.isEditMode ? 'Work order updated successfully.' : 'Work order saved successfully.';
        
        // Reload work order to ensure all fields including customer name are updated
        if (workOrderId) {
          this.isEditMode = true;
          this.workOrderId = workOrderId;
          this.loadWorkOrder(workOrderId);
        } else {
          // Maintain customer name display after save
          this.maintainCustomerDisplay();
        }
      },
      error: (err) => {
        this.workOrderSaveError = err?.error?.message || 'Failed to save work order.';
      }
    });
  }

  maintainCustomerDisplay(): void {
    // Ensure customer name stays populated after save
    if (this.workOrder.customerId && this.customers.length > 0) {
      const customer = this.customers.find(c => c.id === this.workOrder.customerId);
      if (customer) {
        this.customerSearch = customer.displayName || customer.company_name || customer.name || '';
        this.selectedCustomer = customer;
      }
    }
  }

  generateInvoice(): void {
    if (!this.workOrderId) return;
    
    // Create invoice with credit flag
    const payload: any = {};
    if (this.useCustomerCredit) {
      payload.useCredit = true;
    }
    if (this.invoiceInfo) {
      payload.regenerate = true;
    }
    
    this.apiService.generateInvoiceFromWorkOrder(this.workOrderId, payload).subscribe({
      next: (res: any) => {
        this.invoiceInfo = res?.data || res;
        this.creditCheckError = '';
        // Reset credit flag after successful invoice generation
        this.useCustomerCredit = false;
      },
      error: (error: any) => {
        // Check if error is credit-related
        const errorMsg = error?.error?.error || error?.message || 'Failed to generate invoice';
        if (errorMsg.includes('credit') || errorMsg.includes('insufficient')) {
          this.creditCheckError = errorMsg;
        } else {
          this.creditCheckError = errorMsg;
        }
        console.error('Invoice generation error:', error);
      }
    });
  }

  checkCustomerCredit(customerId: string): void {
    if (!customerId) {
      this.availableCredit = 0;
      this.customerCreditLimit = 0;
      this.useCustomerCredit = false;
      return;
    }

    this.creditCheckLoading = true;
    this.creditService.getCustomerCreditBalance(customerId).subscribe({
      next: (response: any) => {
        this.customerCreditLimit = response?.data?.credit_limit || 0;
        this.availableCredit = response?.data?.available_credit || 0;
        this.creditCheckLoading = false;
        this.creditCheckError = '';
      },
      error: (error: any) => {
        console.error('Failed to check credit:', error);
        this.availableCredit = 0;
        this.customerCreditLimit = 0;
        this.creditCheckLoading = false;
        // Don't show error for credit check failures - it's not critical
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
      locationId: this.reservePartForm.locationId || this.workOrder.shopLocationId,
      taxable: true
    };
    this.apiService.reserveWorkOrderPart(this.workOrderId, payload).subscribe({
      next: () => {
        const selected = this.partsCatalog.find(p => String(p.id) === String(this.reservePartForm.partId));
        if (selected) {
          const qty = Number(this.reservePartForm.qtyRequested) || 1;
          const unitCost = Number(this.reservePartForm.unitPrice ?? selected.unit_cost ?? selected.unit_price ?? 0);
          const partLine = {
            partId: selected.id,
            partName: selected.name,
            partNumber: selected.sku,
            quantity: qty,
            unitCost,
            totalCost: qty * unitCost
          };
          this.workOrder.parts.push(partLine);
        }
        this.computeFinancials();
        this.reservePartForm = { partId: '', qtyRequested: 1, unitPrice: null, locationId: this.workOrder.shopLocationId || '' };
        // Reload work order and refresh parts catalog
        this.loadWorkOrder(this.workOrderId as string);
        this.loadParts();
      }
    });
  }

  issuePart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    
    // First, check if part is now in stock and update status if needed
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            // If part now has stock, update the line status from BACKORDERED
            if (part && part.quantity_on_hand && part.quantity_on_hand > 0) {
              line.status = 'PENDING'; // Change from BACKORDERED to PENDING
            }
            // Proceed with issue
            this.proceedWithIssuePart(line);
          } catch (err) {
            console.error('Error processing part stock check:', err);
            this.proceedWithIssuePart(line);
          }
        },
        error: (err: any) => {
          // If we can't check, proceed anyway
          console.error('Error fetching part details:', err);
          this.proceedWithIssuePart(line);
        }
      });
    } else {
      // Not backordered, proceed normally
      this.proceedWithIssuePart(line);
    }
  }

  proceedWithIssuePart(line: any): void {
    if (!this.workOrderId) return;
    
    // Calculate max qty that can be issued
    const reserved = Number(line.qty_reserved) || 0;
    const alreadyIssued = Number(line.qty_issued) || 0;
    const maxCanIssue = Math.max(0, reserved - alreadyIssued);
    
    if (maxCanIssue <= 0) {
      alert('No remaining reserved quantity to issue for this part');
      return;
    }
    
    const qtyStr = prompt(`Qty to issue (max: ${maxCanIssue}):`, maxCanIssue.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    
    if (!qty || qty <= 0) return;
    if (qty > maxCanIssue) {
      alert(`Cannot issue more than ${maxCanIssue}. You have ${maxCanIssue} reserved.`);
      return;
    }
    
    this.apiService.issueWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => {
        this.loadWorkOrder(this.workOrderId as string);
        this.loadParts();
      }
    });
  }

  returnPart(line: any): void {
    if (!this.workOrderId || !line?.id) return;
    
    // First, check if part is now in stock and update status if needed
    if (line.part_id && line.status === 'BACKORDERED') {
      this.apiService.getPartById(line.part_id).subscribe({
        next: (response: any) => {
          try {
            const part = response?.data || response;
            // If part now has stock, update the line status from BACKORDERED
            if (part && part.quantity_on_hand && part.quantity_on_hand > 0) {
              line.status = 'PENDING'; // Change from BACKORDERED to PENDING
            }
            // Proceed with return
            this.proceedWithReturnPart(line);
          } catch (err) {
            console.error('Error processing part stock check:', err);
            this.proceedWithReturnPart(line);
          }
        },
        error: (err: any) => {
          // If we can't check, proceed anyway
          console.error('Error fetching part details:', err);
          this.proceedWithReturnPart(line);
        }
      });
    } else {
      // Not backordered, proceed normally
      this.proceedWithReturnPart(line);
    }
  }

  proceedWithReturnPart(line: any): void {
    if (!this.workOrderId) return;
    
    // Calculate max qty that can be returned
    const issued = Number(line.qty_issued) || 0;
    const maxCanReturn = Math.max(0, issued);
    
    if (maxCanReturn <= 0) {
      alert('No issued quantity to return for this part');
      return;
    }
    
    const qtyStr = prompt(`Qty to return (max: ${maxCanReturn}):`, maxCanReturn.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    
    if (!qty || qty <= 0) return;
    if (qty > maxCanReturn) {
      alert(`Cannot return more than ${maxCanReturn}. You have ${maxCanReturn} issued.`);
      return;
    }
    
    this.apiService.returnWorkOrderPart(this.workOrderId, line.id, qty).subscribe({
      next: () => {
        this.loadWorkOrder(this.workOrderId as string);
        this.loadParts();
      }
    });
  }

  reserveFromLine(line: any): void {
    if (!this.workOrderId || !line?.part_id) return;

    const requested = Number(line.qty_requested) || 0;
    const reserved = Number(line.qty_reserved) || 0;
    const remainingToReserve = Math.max(0, requested - reserved);

    if (remainingToReserve <= 0) {
      alert('No remaining quantity to reserve for this part');
      return;
    }

    const qtyStr = prompt(`Qty to reserve (max: ${remainingToReserve}):`, remainingToReserve.toString());
    const qty = qtyStr ? Number(qtyStr) : 0;
    if (!qty || qty <= 0) return;
    if (qty > remainingToReserve) {
      alert(`Cannot reserve more than ${remainingToReserve}.`);
      return;
    }

    const payload = {
      partId: line.part_id,
      partLineId: line.id,
      qtyRequested: qty,
      unitPrice: line.unit_price,
      locationId: line.location_id || this.workOrder?.shopLocationId
    };

    this.apiService.reserveWorkOrderPart(this.workOrderId, payload).subscribe({
      next: () => {
        this.loadWorkOrder(this.workOrderId as string);
        this.loadParts();
      },
      error: (err: any) => {
        const msg = err?.error?.error || err?.message || 'Failed to reserve part';
        alert(msg);
      }
    });
  }
}
