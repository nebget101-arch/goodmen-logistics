import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dispatch-drivers',
  templateUrl: './dispatch-drivers.component.html',
  styleUrls: ['./dispatch-drivers.component.css']
})
export class DispatchDriversComponent implements OnInit {
  drivers: any[] = [];
  loading = true;
  showNewModal = false;
  saving = false;
  duplicateError: string | null = null;
  existingDriverId: string | null = null;
  editingDriverId: string | null = null;
  trucks: any[] = [];
  trailers: any[] = [];

  driverFilters: {
    name: string;
    type: string;
    status: string;
    hireDate: string;
    termDate: string;
    phone: string;
    email: string;
    truck: string;
    trailer: string;
    payBasis: string;
    payRate: string;
  } = {
    name: '',
    type: '',
    status: '',
    hireDate: '',
    termDate: '',
    phone: '',
    email: '',
    truck: '',
    trailer: '',
    payBasis: '',
    payRate: ''
  };

  newDriver: any = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    status: 'applicant',
    applicationDate: '',
    dateOfBirth: '',
    driverType: 'company',
    payBasis: 'per_mile',
    payRate: null,
    payPercentage: null,
    cdlNumber: '',
    cdlState: '',
    cdlClass: 'A',
    cdlExpiry: '',
    hireDate: '',
    address: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    payableTo: '',
    coDriverId: '',
    truckId: '',
    trailerId: '',
    fuelCardNumber: ''
  };

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.loadDrivers();
    this.loadVehicles();
  }

  get filteredDrivers(): any[] {
    const f = this.driverFilters;
    return (this.drivers || []).filter((d) => {
      if (f.name) {
        const haystack = `${d.firstName || ''} ${d.lastName || ''} ${d.email || ''} ${d.phone || ''}`
          .toLowerCase();
        if (!haystack.includes(f.name.toLowerCase())) return false;
      }
      if (f.type) {
        if ((d.driverType || '').toString() !== f.type) return false;
      }
      if (f.status) {
        if ((d.status || '').toString() !== f.status) return false;
      }
      if (f.hireDate) {
        const val = d.hireDate ? this.normalizeDate(d.hireDate) : '';
        if (!val.includes(f.hireDate)) return false;
      }
      if (f.termDate) {
        const val = d.terminationDate ? this.normalizeDate(d.terminationDate) : '';
        if (!val.includes(f.termDate)) return false;
      }
      if (f.phone) {
        const val = (d.phone || '').toString().toLowerCase();
        if (!val.includes(f.phone.toLowerCase())) return false;
      }
      if (f.email) {
        const val = (d.email || '').toString().toLowerCase();
        if (!val.includes(f.email.toLowerCase())) return false;
      }
      if (f.truck) {
        const val = (d.truckUnitNumber || '').toString().toLowerCase();
        if (!val.includes(f.truck.toLowerCase())) return false;
      }
      if (f.trailer) {
        const val = (d.trailerUnitNumber || '').toString().toLowerCase();
        if (!val.includes(f.trailer.toLowerCase())) return false;
      }
      if (f.payBasis) {
        if ((d.payBasis || '').toString() !== f.payBasis) return false;
      }
      if (f.payRate) {
        const basis = (d.payBasis || '').toString();
        const rate =
          basis === 'percentage'
            ? (d.payPercentage != null ? String(d.payPercentage) : '')
            : (d.payRate != null ? String(d.payRate) : '');
        if (!rate.includes(f.payRate)) return false;
      }
      return true;
    });
  }

  loadDrivers(): void {
    this.loading = true;
    this.apiService.getDispatchDrivers().subscribe({
      next: (data) => {
        this.drivers = data || [];
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading dispatch drivers', err);
        this.loading = false;
      }
    });
  }

  loadVehicles(): void {
    this.apiService.getVehicles().subscribe({
      next: (all) => {
        const list = all || [];
        this.trucks = list.filter((v: any) => {
          const t = (v.vehicle_type || v.vehicleType || '').toString().toLowerCase();
          // Treat anything that is not explicitly 'trailer' as a truck for now
          return t !== 'trailer';
        });
        this.trailers = list.filter((v: any) => {
          const t = (v.vehicle_type || v.vehicleType || '').toString().toLowerCase();
          return t === 'trailer';
        });
      },
      error: (err) => {
        console.error('Error loading vehicles for drivers page', err);
        this.trucks = [];
        this.trailers = [];
      }
    });
  }

  openNew(): void {
    this.resetForm();
    this.showNewModal = true;
    this.duplicateError = null;
    this.existingDriverId = null;
    this.editingDriverId = null;
  }

  closeNew(): void {
    if (this.saving) return;
    this.showNewModal = false;
  }

  onDriverTypeChange(): void {
    if (this.newDriver.driverType === 'owner_operator') {
      this.newDriver.payBasis = 'percentage';
      this.newDriver.payRate = null;
    }
  }

  resetForm(): void {
    this.newDriver = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      status: 'applicant',
      applicationDate: '',
      dateOfBirth: '',
      driverType: 'company',
      payBasis: 'per_mile',
      payRate: null,
      payPercentage: null,
      cdlNumber: '',
      cdlState: '',
      cdlClass: 'A',
      cdlExpiry: '',
      hireDate: '',
      address: '',
      address2: '',
      city: '',
      state: '',
      zip: '',
      payableTo: '',
      coDriverId: '',
      truckId: '',
      trailerId: '',
      fuelCardNumber: ''
    };
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Date picker values for new driver modal
  get newDobValue(): Date | null {
    return this.parseDate(this.newDriver.dateOfBirth);
  }

  get newApplicationDateValue(): Date | null {
    return this.parseDate(this.newDriver.applicationDate);
  }

  get newHireDateValue(): Date | null {
    return this.parseDate(this.newDriver.hireDate);
  }

  get newCdlExpiryValue(): Date | null {
    return this.parseDate(this.newDriver.cdlExpiry);
  }

  onNewDobChange(date: Date | null): void {
    this.newDriver.dateOfBirth = this.normalizeDate(date);
  }

  onNewApplicationDateChange(date: Date | null): void {
    this.newDriver.applicationDate = this.normalizeDate(date);
  }

  onNewHireDateChange(date: Date | null): void {
    this.newDriver.hireDate = this.normalizeDate(date);
  }

  onNewCdlExpiryChange(date: Date | null): void {
    this.newDriver.cdlExpiry = this.normalizeDate(date);
  }

  startEdit(driver: any): void {
    this.editingDriverId = driver.id;
    this.showNewModal = true;
    this.duplicateError = null;
    this.existingDriverId = null;
    // Pull latest details from drivers API (DQF source of truth)
    this.apiService.getDriver(driver.id).subscribe({
      next: (detail) => {
        const source = detail || driver;
        this.newDriver = {
          firstName: source.firstName || '',
          lastName: source.lastName || '',
          email: source.email || '',
          phone: source.phone || '',
          status: source.status || 'applicant',
          applicationDate: this.normalizeDate(source.applicationDate),
          dateOfBirth: this.normalizeDate(source.dateOfBirth),
          driverType: source.driverType || 'company',
          payBasis: source.payBasis || 'per_mile',
          payRate: source.payRate || null,
          payPercentage: source.payPercentage || null,
          cdlNumber: source.cdlNumber || '',
          cdlState: source.cdlState || '',
          cdlClass: source.cdlClass || 'A',
          cdlExpiry: this.normalizeDate(source.cdlExpiry),
          hireDate: this.normalizeDate(source.hireDate),
          address: source.address || '',
          address2: source.address2 || '',
          city: source.city || '',
          state: source.state || '',
          zip: source.zip || '',
          payableTo: source.payableTo || '',
          coDriverId: source.coDriverId || '',
          truckId: source.truckId || '',
          trailerId: source.trailerId || '',
          fuelCardNumber: source.fuelCardNumber || ''
        };
      },
      error: () => {
        // Fallback to list row if detail fetch fails
        this.newDriver = {
          firstName: driver.firstName || '',
          lastName: driver.lastName || '',
          email: driver.email || '',
          phone: driver.phone || '',
          status: driver.status || 'applicant',
          applicationDate: this.normalizeDate(driver.applicationDate),
          dateOfBirth: this.normalizeDate(driver.dateOfBirth),
          driverType: driver.driverType || 'company',
          payBasis: driver.payBasis || 'per_mile',
          payRate: driver.payRate || null,
          payPercentage: driver.payPercentage || null,
          cdlNumber: driver.cdlNumber || '',
          cdlState: driver.cdlState || '',
          cdlClass: driver.cdlClass || 'A',
          cdlExpiry: this.normalizeDate(driver.cdlExpiry),
          hireDate: this.normalizeDate(driver.hireDate),
          address: driver.address || '',
          address2: driver.address2 || '',
          city: driver.city || '',
          state: driver.state || '',
          zip: driver.zip || '',
          payableTo: driver.payableTo || '',
          coDriverId: driver.coDriverId || '',
          truckId: driver.truckId || '',
          trailerId: driver.trailerId || '',
          fuelCardNumber: driver.fuelCardNumber || ''
        };
      }
    });
  }

  saveDriver(): void {
    if (!this.newDriver.firstName || !this.newDriver.lastName ||
        !this.newDriver.cdlNumber || !this.newDriver.cdlState) {
      alert('First name, last name, CDL number, and CDL state are required.');
      return;
    }
    this.saving = true;
    this.duplicateError = null;
    this.existingDriverId = null;

    const payload = { ...this.newDriver };

    if (this.editingDriverId) {
      this.apiService.updateDriver(this.editingDriverId, payload).subscribe({
        next: (updated) => {
          // Reload from dispatch view so joined truck/trailer columns are populated
          this.loadDrivers();
          this.saving = false;
          this.showNewModal = false;
          this.editingDriverId = null;
        },
        error: (error) => {
          this.saving = false;
          console.error('Error updating driver', error);
          alert('Failed to update driver. Please try again.');
        }
      });
    } else {
      this.apiService.createDriver(payload).subscribe({
        next: (driver) => {
          // Reload list so new driver has joined truck/trailer data
          this.loadDrivers();
          this.saving = false;
          this.showNewModal = false;
          this.resetForm();
        },
        error: (error) => {
          this.saving = false;
          if (error.status === 409 && error.error && error.error.code === 'DRIVER_EXISTS') {
            const state = error.error.cdlState;
            const num = error.error.cdlNumber;
            this.duplicateError = `Driver already exists for CDL ${state}-${num}`;
            this.existingDriverId = error.error.existingDriverId || null;
          } else {
            console.error('Error creating driver', error);
            alert('Failed to create driver. Please try again.');
          }
        }
      });
    }
  }
}

