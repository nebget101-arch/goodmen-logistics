import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { CreditService } from '../../../../services/credit.service';
import { PermissionHelperService } from '../../../../services/permission-helper.service';
import { PERMISSIONS } from '../../../../models/access-control.model';

@Component({
  selector: 'app-wo-basics-tab',
  templateUrl: './basics-tab.component.html',
  styleUrls: ['./basics-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoBasicsTabComponent {
  @Input() workOrder: any = {};
  @Input() customers: any[] = [];
  @Input() vehicles: any[] = [];
  @Input() locations: any[] = [];
  @Input() technicians: any[] = [];
  @Input() isEditMode = false;

  /* Credit */
  @Input() customerCreditLimit = 0;
  @Input() availableCredit = 0;
  @Input() creditCheckLoading = false;
  @Input() useCustomerCredit = false;
  @Input() creditCheckError = '';

  /* Customer search state */
  customerSearch = '';
  customerDotSearch = '';
  customerSearchError = '';
  selectedCustomer: any = null;
  filteredCustomers: any[] = [];
  showCustomerDropdown = false;

  /* Inline quick-create customer (replaces modal) */
  showInlineCustomerCreate = false;
  newCustomer: any = { company_name: '', dot_number: '', contact_name: '', phone: '' };
  newCustomerError = '';
  fmcsaLookupLoading = false;

  /* Vehicle search state */
  vehicleSearch = '';
  filteredVehicles: any[] = [];
  showVehicleDropdown = false;

  /* Inline quick-create vehicle (replaces modal) */
  showInlineVehicleCreate = false;
  newCustomerVehicle: any = { vin: '', unit_number: '', license_plate: '' };
  newCustomerVehicleError = '';
  vinDecodeLoading = false;
  vinDecodedInfo: { make: string; model: string; year: string } | null = null;

  constructor(
    private apiService: ApiService,
    private creditService: CreditService,
    private permissions: PermissionHelperService,
    private cdr: ChangeDetectorRef
  ) {}

  /* ─── Customer search ─── */

  populateCustomerDisplay(): void {
    if (this.workOrder.customerId && this.customers.length > 0) {
      const customer = this.customers.find((c: any) => c.id === this.workOrder.customerId) ||
        this.customers.find((c: any) => String(c.id) === String(this.workOrder.customerId));
      if (customer) {
        this.customerSearch = customer.displayName || customer.company_name || customer.name || '';
        this.selectedCustomer = customer;
      } else {
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
              this.customers.push(mappedCustomer);
              this.customerSearch = mappedCustomer.displayName;
              this.selectedCustomer = mappedCustomer;
            }
          }
        });
      }
    }
  }

  populateVehicleDisplay(): void {
    if (this.workOrder.vehicleId && this.workOrder.unitNumber) {
      this.vehicleSearch = `${this.workOrder.unitNumber} - ${this.workOrder.vin || ''}`;
    }
  }

  onCustomerSearchChange(): void {
    if (!this.customerSearch) {
      this.filteredCustomers = [];
      this.showCustomerDropdown = false;
      return;
    }
    const search = this.customerSearch.toLowerCase();
    this.filteredCustomers = this.customers.filter((c: any) => {
      const name = (c.displayName || c.company_name || c.name || '').toLowerCase();
      const dot = (c.dot_number || '').toLowerCase();
      return name.includes(search) || dot.includes(search);
    });
    /* Always show dropdown when typing so the "+ Create new" option is visible */
    this.showCustomerDropdown = true;
  }

  selectCustomer(customer: any): void {
    this.workOrder.customerId = customer.id;
    this.customerSearch = customer.displayName || customer.company_name || customer.name;
    this.showCustomerDropdown = false;
    this.selectedCustomer = customer;
    this.applyCustomerVehicleFilter();
    this.checkCustomerCredit(customer.id);
  }

  onCustomerBlur(): void {
    setTimeout(() => { this.showCustomerDropdown = false; }, 200);
  }

  searchCustomerByDot(): void {
    this.customerSearchError = '';
    this.selectedCustomer = null;
    if (!this.customerDotSearch) return;
    this.apiService.getCustomerByDot(this.customerDotSearch).subscribe({
      next: (data: any) => {
        const rows = data?.rows || data?.data || data || [];
        if (rows && rows.length > 0) {
          this.selectedCustomer = rows[0];
          this.workOrder.customerId = rows[0].id;
          this.customerSearch = rows[0].company_name || rows[0].name || '';
          this.applyCustomerVehicleFilter();
          this.checkCustomerCredit(rows[0].id);
        } else {
          this.fetchFmcsadot(this.customerDotSearch);
        }
      },
      error: () => { this.customerSearchError = 'Error searching customer.'; }
    });
  }

  fetchFmcsadot(dot: string): void {
    this.apiService.getFmcsainfo(dot).subscribe({
      next: (company: any) => {
        if (company) {
          this.newCustomer = {
            company_name: company.legal_name || company.name || '',
            dot_number: dot,
            contact_name: '',
            phone: company.phone || ''
          };
          this.showInlineCustomerCreate = true;
          this.cdr.markForCheck();
        } else {
          this.customerSearchError = 'No customer found for this DOT number.';
          this.cdr.markForCheck();
        }
      },
      error: () => {
        this.customerSearchError = 'FMCSA lookup failed or unavailable.';
        this.cdr.markForCheck();
      }
    });
  }

  createCustomer(): void {
    if (!this.canCreateCustomerInline()) {
      this.newCustomerError = 'You do not have permission to create customers.';
      return;
    }
    this.newCustomerError = '';
    if (!this.newCustomer.company_name) {
      this.newCustomerError = 'Company name is required.';
      return;
    }
    this.apiService.createCustomer(this.newCustomer).subscribe({
      next: (customer: any) => {
        this.customers.push(customer);
        this.workOrder.customerId = customer.id;
        this.selectedCustomer = customer;
        this.showInlineCustomerCreate = false;
        this.customerSearch = customer.company_name || customer.name || '';
        this.applyCustomerVehicleFilter();
        this.checkCustomerCredit(customer.id);
        this.newCustomer = { company_name: '', dot_number: '', contact_name: '', phone: '' };
        this.cdr.markForCheck();
      },
      error: () => {
        this.newCustomerError = 'Failed to create customer.';
        this.cdr.markForCheck();
      }
    });
  }

  canCreateCustomerInline(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT]);
  }

  /* ─── Vehicle search ─── */

  onVehicleSearchChange(): void {
    if (!this.vehicleSearch) {
      const pool = this.getVehicleSearchPool();
      this.filteredVehicles = pool;
      this.showVehicleDropdown = pool.length > 0;
      return;
    }
    const search = this.vehicleSearch.toLowerCase();
    const pool = this.getVehicleSearchPool();
    this.filteredVehicles = pool.filter((v: any) => {
      const unit = (v.unit_number || v.unitNumber || '').toLowerCase();
      const vin = (v.vin || '').toLowerCase();
      const make = (v.make || '').toLowerCase();
      const model = (v.model || '').toLowerCase();
      return unit.includes(search) || vin.includes(search) || make.includes(search) || model.includes(search);
    });
    /* Always show dropdown when typing so the "+ Create new" option is visible */
    this.showVehicleDropdown = true;
  }

  showVehicleDropdownForCustomer(): void {
    const pool = this.getVehicleSearchPool();
    this.filteredVehicles = pool;
    this.showVehicleDropdown = pool.length > 0;
  }

  selectVehicle(vehicle: any): void {
    this.workOrder.vehicleId = vehicle.id;
    const ownership = vehicle.vehicle_source === 'shop_client' || vehicle.company_owned === false ? 'Customer' : 'Internal';
    this.vehicleSearch = `${vehicle.unit_number || vehicle.unitNumber} - ${vehicle.vin} (${ownership})`;
    this.showVehicleDropdown = false;
    this.onVehicleSelect();
  }

  onVehicleBlur(): void {
    setTimeout(() => { this.showVehicleDropdown = false; }, 200);
  }

  onVehicleSelect(): void {
    const selectedId = this.workOrder.vehicleId;
    let vehicle = this.filteredVehicles.find((v: any) => String(v.id) === String(selectedId));
    if (!vehicle) {
      vehicle = this.vehicles.find((v: any) => String(v.id) === String(selectedId));
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

      const isCompanyOwned = vehicle.vehicle_source === 'fleet' || vehicle.is_company_owned === true || vehicle.company_owned === true;
      if (isCompanyOwned) {
        const internalCustomer = this.customers.find((c: any) => c.name === 'Internal' || c.company_name === 'Internal');
        if (internalCustomer) {
          this.workOrder.customerId = internalCustomer.id;
          this.customerSearch = internalCustomer.displayName || internalCustomer.company_name || 'Internal';
          this.selectedCustomer = internalCustomer;
        }
      } else if (vehicle.customer_id) {
        this.workOrder.customerId = vehicle.customer_id;
        const customer = this.customers.find((c: any) => c.id === vehicle.customer_id);
        if (customer) {
          this.customerSearch = customer.displayName || customer.company_name || customer.name;
          this.selectedCustomer = customer;
        }
      }
    }
  }

  /** Opens the inline quick-create vehicle form (replaces old modal) */
  openInlineVehicleCreate(prefillSearch?: string): void {
    if (!this.canCreateVehicleInline()) {
      this.newCustomerVehicleError = 'You do not have permission to create vehicles.';
      return;
    }
    this.newCustomerVehicleError = '';
    this.vinDecodedInfo = null;
    const searchVal = (prefillSearch || this.vehicleSearch || '').trim();
    /* Guess whether the search text is a VIN (17 chars alphanumeric) or a unit number */
    const isLikelyVin = /^[A-HJ-NPR-Z0-9]{6,17}$/i.test(searchVal);
    this.newCustomerVehicle = {
      vin: isLikelyVin ? searchVal : '',
      unit_number: isLikelyVin ? '' : searchVal,
      license_plate: ''
    };
    this.showInlineVehicleCreate = true;
    this.showVehicleDropdown = false;
    this.cdr.markForCheck();
  }

  /** Opens the inline quick-create customer form (replaces old modal) */
  openInlineCustomerCreate(): void {
    if (!this.canCreateCustomerInline()) {
      this.newCustomerError = 'You do not have permission to create customers.';
      return;
    }
    this.newCustomerError = '';
    this.newCustomer = {
      company_name: this.customerSearch || '',
      dot_number: '',
      contact_name: '',
      phone: ''
    };
    this.showInlineCustomerCreate = true;
    this.showCustomerDropdown = false;
    this.cdr.markForCheck();
  }

  cancelInlineCustomerCreate(): void {
    this.showInlineCustomerCreate = false;
    this.newCustomerError = '';
    this.cdr.markForCheck();
  }

  cancelInlineVehicleCreate(): void {
    this.showInlineVehicleCreate = false;
    this.newCustomerVehicleError = '';
    this.vinDecodedInfo = null;
    this.cdr.markForCheck();
  }

  /** FMCSA lookup for the inline quick-create customer form */
  lookupFmcsaForInlineCustomer(): void {
    const dot = (this.newCustomer.dot_number || '').trim();
    if (!dot) {
      this.newCustomerError = 'Enter a DOT number to look up.';
      return;
    }
    this.fmcsaLookupLoading = true;
    this.newCustomerError = '';
    this.cdr.markForCheck();
    this.apiService.getFmcsainfo(dot).subscribe({
      next: (company: any) => {
        this.fmcsaLookupLoading = false;
        if (company) {
          this.newCustomer.company_name = company.legal_name || company.name || this.newCustomer.company_name;
          this.newCustomer.phone = company.phone || this.newCustomer.phone;
        } else {
          this.newCustomerError = 'No FMCSA record found for this DOT.';
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.fmcsaLookupLoading = false;
        this.newCustomerError = 'FMCSA lookup failed.';
        this.cdr.markForCheck();
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
    this.vinDecodeLoading = true;
    this.cdr.markForCheck();
    this.apiService.decodeVin(vin).subscribe({
      next: (decoded: any) => {
        this.vinDecodeLoading = false;
        this.vinDecodedInfo = {
          make: decoded.make || '',
          model: decoded.model || '',
          year: decoded.year || ''
        };
        this.cdr.markForCheck();
      },
      error: () => {
        this.vinDecodeLoading = false;
        this.newCustomerVehicleError = 'Failed to decode VIN.';
        this.cdr.markForCheck();
      }
    });
  }

  createVehicleFromWorkOrder(): void {
    if (!this.canCreateVehicleInline()) {
      this.newCustomerVehicleError = 'You do not have permission to create vehicles.';
      return;
    }
    this.newCustomerVehicleError = '';
    if (!this.newCustomerVehicle.vin) {
      this.newCustomerVehicleError = 'VIN is required.';
      return;
    }

    /* Build the payload: 3 user fields + decoded info */
    const payload: any = {
      vin: this.newCustomerVehicle.vin,
      unit_number: this.newCustomerVehicle.unit_number,
      license_plate: this.newCustomerVehicle.license_plate
    };
    if (this.vinDecodedInfo) {
      payload.make = this.vinDecodedInfo.make;
      payload.model = this.vinDecodedInfo.model;
      payload.year = this.vinDecodedInfo.year;
    }

    /* Link to customer if one is selected; otherwise company-owned */
    if (this.workOrder.customerId) {
      payload.customer_id = this.workOrder.customerId;
      this.apiService.createCustomerVehicle(payload).subscribe({
        next: (vehicle: any) => {
          vehicle.company_owned = false;
          this.vehicles.push(vehicle);
          this.filteredVehicles = [vehicle];
          this.selectVehicle(vehicle);
          this.showInlineVehicleCreate = false;
          this.vinDecodedInfo = null;
          this.cdr.markForCheck();
        },
        error: () => {
          this.newCustomerVehicleError = 'Failed to create customer vehicle.';
          this.cdr.markForCheck();
        }
      });
    } else {
      this.apiService.createVehicle(payload).subscribe({
        next: (vehicle: any) => {
          vehicle.company_owned = true;
          this.vehicles.push(vehicle);
          this.filteredVehicles = [vehicle];
          this.selectVehicle(vehicle);
          this.showInlineVehicleCreate = false;
          this.vinDecodedInfo = null;
          this.cdr.markForCheck();
        },
        error: () => {
          this.newCustomerVehicleError = 'Failed to create company vehicle.';
          this.cdr.markForCheck();
        }
      });
    }
  }

  canCreateVehicleInline(): boolean {
    return this.permissions.hasAnyPermission([PERMISSIONS.VEHICLES_CREATE, PERMISSIONS.VEHICLES_EDIT]);
  }

  /* ─── Private helpers ─── */

  private getVehicleSearchPool(): any[] {
    if (!this.workOrder.customerId) return this.vehicles;
    return this.vehicles.filter((v: any) => String(v.customer_id) === String(this.workOrder.customerId));
  }

  private applyCustomerVehicleFilter(): void {
    if (!this.workOrder.customerId) return;
    const selectedVehicleId = this.workOrder.vehicleId;
    if (selectedVehicleId) {
      const selectedVehicle = this.vehicles.find((v: any) => String(v.id) === String(selectedVehicleId));
      if (selectedVehicle && String(selectedVehicle.customer_id) !== String(this.workOrder.customerId)) {
        this.workOrder.vehicleId = null;
        this.vehicleSearch = '';
        this.resetVehicleDetails();
      }
    }
  }

  private resetVehicleDetails(): void {
    this.workOrder.unitNumber = '';
    this.workOrder.vin = '';
    this.workOrder.licensePlate = '';
    this.workOrder.make = '';
    this.workOrder.model = '';
    this.workOrder.year = '';
    this.workOrder.vehicleType = '';
    this.workOrder.currentOdometer = '';
    this.workOrder.engineHours = '';
    this.workOrder.fleetTerminal = '';
    this.workOrder.driverAssigned = '';
    this.workOrder.vehicleStatus = '';
  }

  private checkCustomerCredit(customerId: string): void {
    if (!customerId) return;
    this.creditService.getCustomerCreditBalance(customerId).subscribe({
      next: (response: any) => {
        this.workOrder._creditLimit = response?.data?.credit_limit || 0;
        this.workOrder._availableCredit = response?.data?.available_credit || 0;
      },
      error: () => { /* non-critical */ }
    });
  }
}
