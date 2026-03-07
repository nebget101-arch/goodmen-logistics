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

  /** Active tab in driver modal: Pay rates | Recurring deductions | Additional payee | Notes */
  payTab: 'rates' | 'deductions' | 'payee' | 'notes' = 'rates';

  /** Expense responsibility: who bears each cost (company | driver | owner | shared) */
  expenseResponsibility: Record<string, string> = {
    fuel: '',
    insurance: '',
    eld: '',
    trailerRent: '',
    tolls: '',
    repairs: ''
  };

  /** Placeholder for recurring deduction rules (backend TBD) */
  recurringDeductions: { id: string; description: string; weeklyAmount: number; active: boolean }[] = [];

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
    payModel: 'per_mile',
    flatWeeklyAmount: null as number | null,
    flatPerLoadAmount: null as number | null,
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
    additionalPayee: '',
    payeeReason: '',
    effectiveStart: '',
    effectiveEnd: '',
    compensationNotes: '',
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
      this.newDriver.payModel = 'percentage';
      this.newDriver.payRate = null;
    }
    if (this.newDriver.driverType === 'hired_driver') {
      this.newDriver.payBasis = this.newDriver.payBasis || 'per_mile';
      this.newDriver.payModel = this.newDriver.payModel || 'per_mile';
    }
  }

  setPayTab(tab: 'rates' | 'deductions' | 'payee' | 'notes'): void {
    this.payTab = tab;
  }

  setPayModel(model: string): void {
    this.newDriver.payModel = model;
    if (model === 'per_mile') this.newDriver.payBasis = 'per_mile';
    else if (model === 'percentage') this.newDriver.payBasis = 'percentage';
    else this.newDriver.payBasis = 'flatpay';
  }

  setExpenseResponsibility(key: string, value: string): void {
    this.expenseResponsibility = { ...this.expenseResponsibility, [key]: value };
  }

  get expenseKeys(): { key: string; label: string }[] {
    return [
      { key: 'fuel', label: 'Fuel' },
      { key: 'insurance', label: 'Insurance' },
      { key: 'eld', label: 'ELD' },
      { key: 'trailerRent', label: 'Trailer rent' },
      { key: 'tolls', label: 'Tolls' },
      { key: 'repairs', label: 'Repairs' }
    ];
  }

  get responsibilityOptions(): { value: string; label: string }[] {
    return [
      { value: '', label: '—' },
      { value: 'company', label: 'Company' },
      { value: 'driver', label: 'Driver' },
      { value: 'owner', label: 'Owner' },
      { value: 'shared', label: 'Shared' }
    ];
  }

  getDriverTypeLabel(type: string): string {
    const t = (type || '').toString();
    if (t === 'owner_operator') return 'Owner operator';
    if (t === 'hired_driver') return 'Hired driver';
    return 'Company';
  }

  resetForm(): void {
    this.payTab = 'rates';
    this.expenseResponsibility = { fuel: '', insurance: '', eld: '', trailerRent: '', tolls: '', repairs: '' };
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
      payModel: 'per_mile',
      flatWeeklyAmount: null,
      flatPerLoadAmount: null,
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
      additionalPayee: '',
      payeeReason: '',
      effectiveStart: '',
      effectiveEnd: '',
      compensationNotes: '',
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
        this.newDriver = this.buildDriverFromSource(source);
      },
      error: () => {
        this.newDriver = this.buildDriverFromSource(driver);
      }
    });
  }

  private buildDriverFromSource(source: any): any {
    const basis = (source.payBasis || 'per_mile').toString();
    let payModel = basis;
    if (basis === 'flatpay') payModel = source.flatPerLoadAmount != null ? 'flat_per_load' : 'flat_weekly';
    return {
      firstName: source.firstName || '',
      lastName: source.lastName || '',
      email: source.email || '',
      phone: source.phone || '',
      status: source.status || 'applicant',
      applicationDate: this.normalizeDate(source.applicationDate),
      dateOfBirth: this.normalizeDate(source.dateOfBirth),
      driverType: source.driverType || 'company',
      payBasis: source.payBasis || 'per_mile',
      payRate: source.payRate ?? null,
      payPercentage: source.payPercentage ?? null,
      payModel: source.payModel || payModel,
      flatWeeklyAmount: source.flatWeeklyAmount ?? (basis === 'flatpay' && source.payRate != null ? Number(source.payRate) : null),
      flatPerLoadAmount: source.flatPerLoadAmount ?? null,
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
      additionalPayee: source.additionalPayee || '',
      payeeReason: source.payeeReason || '',
      effectiveStart: source.effectiveStart || this.normalizeDate(source.effectiveStart) || '',
      effectiveEnd: source.effectiveEnd || this.normalizeDate(source.effectiveEnd) || '',
      compensationNotes: source.compensationNotes || '',
      coDriverId: source.coDriverId || '',
      truckId: source.truckId || '',
      trailerId: source.trailerId || '',
      fuelCardNumber: source.fuelCardNumber || ''
    };
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

    const payload: any = { ...this.newDriver };
    if (payload.driverType === 'hired_driver') payload.driverType = 'owner_operator';
    const pm = (this.newDriver.payModel || this.newDriver.payBasis || 'per_mile').toString();
    if (pm === 'flat_weekly' && this.newDriver.flatWeeklyAmount != null) {
      payload.payBasis = 'flatpay';
      payload.payRate = this.newDriver.flatWeeklyAmount;
    } else if (pm === 'flat_per_load' && this.newDriver.flatPerLoadAmount != null) {
      payload.payBasis = 'flatpay';
      payload.payRate = this.newDriver.flatPerLoadAmount;
    }
    delete payload.payModel;
    delete payload.flatWeeklyAmount;
    delete payload.flatPerLoadAmount;
    delete payload.additionalPayee;
    delete payload.payeeReason;
    delete payload.effectiveStart;
    delete payload.effectiveEnd;
    delete payload.compensationNotes;

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

