import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { forkJoin, of } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-dispatch-drivers',
  templateUrl: './dispatch-drivers.component.html',
  styleUrls: ['./dispatch-drivers.component.css']
})
export class DispatchDriversComponent implements OnInit, OnDestroy {

  readonly statusOptions = [
    { value: 'applicant', label: 'Applicant' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' }
  ];

  readonly US_STATES = [
    { value: 'AL', label: 'Alabama (AL)' }, { value: 'AK', label: 'Alaska (AK)' },
    { value: 'AZ', label: 'Arizona (AZ)' }, { value: 'AR', label: 'Arkansas (AR)' },
    { value: 'CA', label: 'California (CA)' }, { value: 'CO', label: 'Colorado (CO)' },
    { value: 'CT', label: 'Connecticut (CT)' }, { value: 'DC', label: 'Washington DC (DC)' },
    { value: 'DE', label: 'Delaware (DE)' }, { value: 'FL', label: 'Florida (FL)' },
    { value: 'GA', label: 'Georgia (GA)' }, { value: 'HI', label: 'Hawaii (HI)' },
    { value: 'ID', label: 'Idaho (ID)' }, { value: 'IL', label: 'Illinois (IL)' },
    { value: 'IN', label: 'Indiana (IN)' }, { value: 'IA', label: 'Iowa (IA)' },
    { value: 'KS', label: 'Kansas (KS)' }, { value: 'KY', label: 'Kentucky (KY)' },
    { value: 'LA', label: 'Louisiana (LA)' }, { value: 'ME', label: 'Maine (ME)' },
    { value: 'MD', label: 'Maryland (MD)' }, { value: 'MA', label: 'Massachusetts (MA)' },
    { value: 'MI', label: 'Michigan (MI)' }, { value: 'MN', label: 'Minnesota (MN)' },
    { value: 'MS', label: 'Mississippi (MS)' }, { value: 'MO', label: 'Missouri (MO)' },
    { value: 'MT', label: 'Montana (MT)' }, { value: 'NE', label: 'Nebraska (NE)' },
    { value: 'NV', label: 'Nevada (NV)' }, { value: 'NH', label: 'New Hampshire (NH)' },
    { value: 'NJ', label: 'New Jersey (NJ)' }, { value: 'NM', label: 'New Mexico (NM)' },
    { value: 'NY', label: 'New York (NY)' }, { value: 'NC', label: 'North Carolina (NC)' },
    { value: 'ND', label: 'North Dakota (ND)' }, { value: 'OH', label: 'Ohio (OH)' },
    { value: 'OK', label: 'Oklahoma (OK)' }, { value: 'OR', label: 'Oregon (OR)' },
    { value: 'PA', label: 'Pennsylvania (PA)' }, { value: 'RI', label: 'Rhode Island (RI)' },
    { value: 'SC', label: 'South Carolina (SC)' }, { value: 'SD', label: 'South Dakota (SD)' },
    { value: 'TN', label: 'Tennessee (TN)' }, { value: 'TX', label: 'Texas (TX)' },
    { value: 'UT', label: 'Utah (UT)' }, { value: 'VT', label: 'Vermont (VT)' },
    { value: 'VA', label: 'Virginia (VA)' }, { value: 'WA', label: 'Washington (WA)' },
    { value: 'WV', label: 'West Virginia (WV)' }, { value: 'WI', label: 'Wisconsin (WI)' },
    { value: 'WY', label: 'Wyoming (WY)' }
  ];

  zipLookupLoading = false;
  zipLookupError = '';

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
    phone: '',
    email: '',
    truck: '',
    trailer: '',
    payBasis: '',
    payRate: ''
  };

  /** Active tab in driver modal: Pay rates | Recurring deductions | Additional payee | Notes */
  payTab: 'rates' | 'deductions' | 'payee' | 'notes' = 'rates';
  /** Payee search state */
  allPayees: any[] = []; // Full list of available payees
  primaryPayeeSearch = '';
  filteredPrimaryPayees: any[] = [];
  showPrimaryPayeeDropdown = false;
  selectedPrimaryPayeeId = '';
  selectedPrimaryPayeeName = '';

  additionalPayeeSearch = '';
  filteredAdditionalPayees: any[] = [];
  showAdditionalPayeeDropdown = false;
  selectedAdditionalPayeeId = '';
  selectedAdditionalPayeeName = '';

  /** Equipment Owner creation state */
  isCreatingEquipmentOwner: boolean = false;
  newEquipmentOwner = {
    companyName: '',
    address: '',
    address2: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    zip: '',
    fidEin: '',
    mc: '',
    notes: '',
    vendorType: '',
    additionalPayee: true,
    equipmentOwner: true,
    additionalPayeeRate: null as number | null,
    settlementTemplateType: ''
  };

  readonly settlementTemplateTypes = [
    { value: '', label: 'Select template type' },
    { value: 'standard', label: 'Standard' },
    { value: 'owner_operator', label: 'Owner Operator' },
    { value: 'leased_owner', label: 'Leased Owner' }
  ];


  /** Expense responsibility: who bears each cost (company | driver | owner | shared) */
  expenseResponsibility: Record<string, string> = {
    fuel: '',
    insurance: '',
    eld: '',
    trailerRent: '',
    tolls: '',
    repairs: ''
  };

  /**
   * Stable arrays for expense *ngFor (not getters).
   * Root cause of "edit stuck": after switching to [ngModel]/(ngModelChange) on the expense selects,
   * using getters here returned new array refs every change detection, so *ngFor recreated the
   * selects each cycle and could trigger a feedback loop with ngModel. Use readonly arrays instead.
   */
  readonly expenseKeys: { key: string; label: string }[] = [
    { key: 'fuel', label: 'Fuel' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'eld', label: 'ELD' },
    { key: 'trailerRent', label: 'Trailer rent' },
    { key: 'tolls', label: 'Tolls' },
    { key: 'repairs', label: 'Repairs' }
  ];

  readonly responsibilityOptions: { value: string; label: string }[] = [
    { value: '', label: '—' },
    { value: 'company', label: 'Company' },
    { value: 'driver', label: 'Driver' },
    { value: 'owner', label: 'Owner' },
    { value: 'shared', label: 'Shared' }
  ];

  readonly driverTypeOptions = [
    { value: 'company', label: 'Company' },
    { value: 'owner_operator', label: 'Owner Operator' },
    { value: 'hired_driver', label: 'Hired Driver' }
  ];

  readonly driverStatusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'applicant', label: 'Applicant' }
  ];

  readonly payBasisOptions = [
    { value: 'per_mile', label: 'Per Mile' },
    { value: 'percentage', label: 'Percentage' },
    { value: 'flatpay', label: 'Flat Pay' },
    { value: 'hourly', label: 'Hourly' }
  ];

  readonly cdlClassOptions = [
    { value: 'A', label: 'Class A' },
    { value: 'B', label: 'Class B' },
    { value: 'C', label: 'Class C' }
  ];

  readonly deductionTargetOptions = [
    { value: 'primary', label: 'Primary payee' },
    { value: 'additional', label: 'Additional payee' }
  ];

  readonly deductionAmountTypeOptions = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'percentage', label: 'Percentage' }
  ];

  truckSelectOptions: { value: string; label: string }[] = [];

  trailerSelectOptions: { value: string; label: string }[] = [];

  readonly expenseCategoryOptions = [
    { value: '', label: 'Manual / not expense-specific' },
    ...this.expenseKeys.map(e => ({ value: e.key, label: e.label }))
  ];

  readonly sourceTypeOptions = [
    { value: '', label: 'Select expense' },
    { value: 'fuel', label: 'Fuel' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'eld', label: 'ELD' },
    { value: 'trailer_rent', label: 'Trailer rent' },
    { value: 'toll', label: 'Tolls' },
    { value: 'repairs', label: 'Repairs' }
  ];

  recurringDeductions: any[] = [];
  loadingRecurringDeductions = false;
  addingRecurringDeduction = false;
  editingRecurringDeductionId: string | null = null;
  editingRecurringDeductionDraft: {
    description: string;
    amount: number | null;
    start_date: string;
    end_date: string;
  } = {
    description: '',
    amount: null,
    start_date: '',
    end_date: ''
  };
  savingRecurringDeductionEdit = false;
  showRecurringDeductionModal = false;
  newRecurringDeduction: {
    target: 'primary' | 'additional';
    expense_category: '' | 'fuel' | 'insurance' | 'eld' | 'trailerRent' | 'tolls' | 'repairs';
    description: string;
    amount_type: 'fixed' | 'percentage';
    amount: number | null;
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'per_settlement';
    start_date: string;
    applies_when: 'always' | 'has_loads' | 'specific_expense';
    source_type: string;
    enabled: boolean;
  } = {
    target: 'primary',
    expense_category: '',
    description: '',
    amount_type: 'fixed',
    amount: null,
    frequency: 'weekly',
    start_date: new Date().toISOString().slice(0, 10),
    applies_when: 'always',
    source_type: '',
    enabled: true
  };
  readonly deductionFrequencyOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Bi-weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'per_settlement', label: 'Per settlement' }
  ];
  readonly deductionAppliesWhenOptions = [
    { value: 'always', label: 'Always' },
    { value: 'has_loads', label: 'Only when driver has loads' },
    { value: 'specific_expense', label: 'Specific expense responsibility' }
  ];
  readonly deductionExpenseTypeOptions = [
    { value: 'fuel', label: 'Fuel' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'eld', label: 'ELD' },
    { value: 'trailer_rent', label: 'Trailer rent' },
    { value: 'toll', label: 'Tolls' },
    { value: 'repairs', label: 'Repairs' }
  ];
  driverBackfill = {
    start_date: '',
    end_date: '',
    include_locked: false,
    dry_run: true,
    limit: 300
  };
  driverBackfilling = false;
  driverBackfillResult: any = null;
  driverBackfillWarning = '';

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

  activeOperatingEntityName = '';
  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private router: Router,
    private operatingEntityContext: OperatingEntityContextService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.loadAllPayees();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          this.loadDrivers();
          this.loadVehicles();
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.drivers = [];
          this.trucks = [];
          this.trailers = [];
          this.loadDrivers();
          this.loadVehicles();
        }
      });
  }

  loadAllPayees(): void {
    this.apiService.getAllPayees({ is_active: true, limit: 200 }).subscribe({
      next: (payees) => {
        this.allPayees = payees || [];
      },
      error: (err) => {
        console.error('Error loading payees', err);
        this.allPayees = [];
      }
    });
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
        this.truckSelectOptions = this.trucks.map(t => ({
          value: t.id,
          label: [t.unit_number, t.make, t.model].filter(Boolean).join(' - ') || t.id
        }));
        this.trailerSelectOptions = this.trailers.map(t => ({
          value: t.id,
          label: [t.unit_number, t.make, t.model].filter(Boolean).join(' - ') || t.id
        }));
      },
      error: (err) => {
        console.error('Error loading vehicles for drivers page', err);
        this.trucks = [];
        this.trailers = [];
        this.trailerSelectOptions = [];
      }
    });
  }

  private normalizeId(value: any): string {
    return (value ?? '').toString().trim();
  }

  private getEditingDriverAssignedTrailerId(): string {
    if (!this.editingDriverId) return '';
    const current = (this.drivers || []).find(
      (d: any) => this.normalizeId(d?.id) === this.normalizeId(this.editingDriverId)
    );
    return this.normalizeId(current?.trailerId ?? current?.trailer_id);
  }

  get availableTrailers(): any[] {
    const assignedToOtherDrivers = new Set<string>();

    (this.drivers || []).forEach((d: any) => {
      const driverId = this.normalizeId(d?.id);
      if (this.editingDriverId && driverId === this.normalizeId(this.editingDriverId)) {
        return;
      }
      const trailerId = this.normalizeId(d?.trailerId ?? d?.trailer_id);
      if (trailerId) assignedToOtherDrivers.add(trailerId);
    });

    const selectedTrailerId = this.normalizeId(this.newDriver?.trailerId);
    const editingDriverTrailerId = this.getEditingDriverAssignedTrailerId();

    return (this.trailers || []).filter((tr: any) => {
      const id = this.normalizeId(tr?.id);
      if (!id) return false;
      if (selectedTrailerId && id === selectedTrailerId) return true;
      if (editingDriverTrailerId && id === editingDriverTrailerId) return true;
      return !assignedToOtherDrivers.has(id);
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
    if (tab === 'deductions' && this.editingDriverId) {
      this.loadRecurringDeductions(this.editingDriverId);
    }
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
    this.primaryPayeeSearch = '';
    this.additionalPayeeSearch = '';
    this.selectedPrimaryPayeeId = '';
    this.selectedAdditionalPayeeId = '';
    this.filteredPrimaryPayees = [];
    this.filteredAdditionalPayees = [];
    this.showPrimaryPayeeDropdown = false;
    this.showAdditionalPayeeDropdown = false;
    this.isCreatingEquipmentOwner = false;
    this.recurringDeductions = [];
    this.editingRecurringDeductionId = null;
    this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
    this.savingRecurringDeductionEdit = false;
    this.loadingRecurringDeductions = false;
    this.addingRecurringDeduction = false;
    this.driverBackfill = { start_date: '', end_date: '', include_locked: false, dry_run: true, limit: 300 };
    this.driverBackfilling = false;
    this.driverBackfillResult = null;
    this.driverBackfillWarning = '';
    this.showRecurringDeductionModal = false;
    this.resetRecurringDeductionDraft();
    this.newEquipmentOwner = {
      companyName: '',
      address: '',
      address2: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      zip: '',
      fidEin: '',
      mc: '',
      notes: '',
      vendorType: '',
      additionalPayee: true,
      equipmentOwner: true,
      additionalPayeeRate: null,
      settlementTemplateType: ''
    };
  }

  onZipCodeChange(zip: string): void {
    this.zipLookupError = '';
    if (!zip || zip.length !== 5 || !/^\d{5}$/.test(zip)) return;
    this.zipLookupLoading = true;
    this.http.get<any>(`https://api.zippopotam.us/us/${zip}`).subscribe({
      next: (data) => {
        if (data?.places?.length) {
          this.newDriver.city = data.places[0]['place name'] || '';
          this.newDriver.state = data.places[0]['state abbreviation'] || '';
        }
        this.zipLookupLoading = false;
      },
      error: () => {
        this.zipLookupError = 'Zip not found — enter city/state manually';
        this.zipLookupLoading = false;
      }
    });
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  formatDateOnly(value: any): string {
    return this.normalizeDate(value);
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
    this.duplicateError = null;
    this.existingDriverId = null;
    this.payTab = 'rates';
    this.expenseResponsibility = { fuel: '', insurance: '', eld: '', trailerRent: '', tolls: '', repairs: '' };
    this.newDriver = this.buildDriverFromSource(driver);
    this.primaryPayeeSearch = this.newDriver.payableTo || '';
    this.additionalPayeeSearch = this.newDriver.additionalPayee || '';
    this.selectedPrimaryPayeeId = '';
    this.selectedAdditionalPayeeId = '';
    this.recurringDeductions = [];
    this.resetRecurringDeductionDraft();
    this.showNewModal = true;
    // Defer API call so the modal renders first (avoids change-detection thrash with expense selects)
    const driverId = driver.id;
    setTimeout(() => {
      this.apiService.getDriver(driverId).subscribe({
        next: (detail) => {
          this.newDriver = this.buildDriverFromSource(detail);
          this.primaryPayeeSearch = this.newDriver.payableTo || '';
          this.additionalPayeeSearch = this.newDriver.additionalPayee || '';
          this.selectedPrimaryPayeeId = detail?.primaryPayeeId || '';
          this.selectedAdditionalPayeeId = detail?.additionalPayeeId || '';

          if (detail?.fuelResponsibility || detail?.insuranceResponsibility || detail?.eldResponsibility || detail?.trailerRentResponsibility || detail?.tollResponsibility || detail?.repairsResponsibility) {
            this.expenseResponsibility = {
              fuel: detail.fuelResponsibility || '',
              insurance: detail.insuranceResponsibility || '',
              eld: detail.eldResponsibility || '',
              trailerRent: detail.trailerRentResponsibility || '',
              tolls: detail.tollResponsibility || '',
              repairs: detail.repairsResponsibility || ''
            };
          }
          
          // Load payee assignment
          this.apiService.getPayeeAssignment(driverId).subscribe({
            next: (response: any) => {
              // Response includes: { assignment, primary_payee, additional_payee }
              const assignment = response?.assignment || response;
              const primaryPayee = response?.primary_payee;
              const additionalPayee = response?.additional_payee;

              if (assignment?.primary_payee_id && primaryPayee) {
                this.selectedPrimaryPayeeId = assignment.primary_payee_id;
              }
              
              if (assignment?.additional_payee_id && additionalPayee) {
                this.selectedAdditionalPayeeId = assignment.additional_payee_id;
                this.additionalPayeeSearch = additionalPayee.name;
                this.selectedAdditionalPayeeName = additionalPayee.name;
              }

              this.loadRecurringDeductions(driverId);
            },
            error: (err) => {
              // 404 is expected for drivers without payee assignment yet
              if (err.status !== 404) {
                console.error('Error loading payee assignment:', err);
              }
            }
          });
          
          // Load expense responsibility
          this.apiService.getExpenseResponsibility(driverId).subscribe({
            next: (expense) => {
              if (expense) {
                this.expenseResponsibility = {
                  fuel: expense.fuel_responsibility || '',
                  insurance: expense.insurance_responsibility || '',
                  eld: expense.eld_responsibility || '',
                  trailerRent: expense.trailer_rent_responsibility || '',
                  tolls: expense.toll_responsibility || '',
                  repairs: expense.repairs_responsibility || ''
                };
              }
            },
            error: () => {
              // No expense responsibility found, skip
            }
          });

          // Load recurring deductions for this driver
          this.loadRecurringDeductions(driverId);
        },
        error: () => {
          this.newDriver = this.buildDriverFromSource(driver);
          this.primaryPayeeSearch = this.newDriver.payableTo || '';
          this.additionalPayeeSearch = this.newDriver.additionalPayee || '';
          this.selectedPrimaryPayeeId = '';
          this.selectedAdditionalPayeeId = '';
          this.loadRecurringDeductions(driverId);
        }
      });
    }, 0);
  }

  resetRecurringDeductionDraft(): void {
    this.newRecurringDeduction = {
      target: 'primary',
      expense_category: '',
      description: '',
      amount_type: 'fixed',
      amount: null,
      frequency: 'weekly',
      start_date: new Date().toISOString().slice(0, 10),
      applies_when: 'always',
      source_type: '',
      enabled: true
    };
  }

  loadRecurringDeductions(driverId: string): void {
    if (!driverId) {
      this.recurringDeductions = [];
      this.editingRecurringDeductionId = null;
      this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
      this.savingRecurringDeductionEdit = false;
      this.driverBackfillWarning = '';
      return;
    }

    this.loadingRecurringDeductions = true;
    const payeeIds = [this.selectedPrimaryPayeeId, this.selectedAdditionalPayeeId].filter(Boolean);
    this.apiService.getRecurringDeductions({ driver_id: driverId, payee_ids: payeeIds }).subscribe({
      next: (res: any) => {
        const rows = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
        const unique = new Map<string, any>();
        rows.forEach((row: any) => {
          if (row?.id) unique.set(row.id, row);
        });
        this.recurringDeductions = Array.from(unique.values());
        this.editingRecurringDeductionId = null;
        this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
        this.savingRecurringDeductionEdit = false;
        this.updateDriverBackfillWarning();
        this.loadingRecurringDeductions = false;
      },
      error: (err: any) => {
        console.error('Error loading recurring deductions:', err);
        this.recurringDeductions = [];
        this.editingRecurringDeductionId = null;
        this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
        this.savingRecurringDeductionEdit = false;
        this.driverBackfillWarning = '';
        this.loadingRecurringDeductions = false;
      }
    });
  }

  addRecurringDeduction(): void {
    if (!this.editingDriverId) {
      alert('Save the driver first, then add recurring deductions.');
      return;
    }

    if (!this.newRecurringDeduction.description.trim() || this.newRecurringDeduction.amount == null || this.newRecurringDeduction.amount <= 0) {
      alert('Description and amount are required.');
      return;
    }

    const selectedCategory = this.newRecurringDeduction.expense_category;
    const suggestedTargets = this.getSuggestedTargetsForSelectedCategory();
    const effectiveTargets: Array<'primary' | 'additional'> = selectedCategory
      ? suggestedTargets
      : [this.newRecurringDeduction.target];

    if (effectiveTargets.includes('additional') && !this.selectedAdditionalPayeeId) {
      alert('Select an additional payee first in the Additional Payee tab.');
      return;
    }

    const basePayload: any = {
      driver_id: this.editingDriverId,
      description: this.newRecurringDeduction.description.trim(),
      amount_type: this.newRecurringDeduction.amount_type,
      amount: Number(this.newRecurringDeduction.amount),
      frequency: this.newRecurringDeduction.frequency,
      start_date: this.newRecurringDeduction.start_date || new Date().toISOString().slice(0, 10),
      applies_when: selectedCategory ? 'specific_expense' : this.newRecurringDeduction.applies_when,
      enabled: this.newRecurringDeduction.enabled
    };

    const sourceType = selectedCategory
      ? this.mapExpenseCategoryToSourceType(selectedCategory)
      : this.newRecurringDeduction.source_type;

    if (basePayload.applies_when === 'specific_expense' && sourceType) {
      basePayload.source_type = sourceType;
    }

    const requests = effectiveTargets.map((target) => {
      const payload: any = { ...basePayload };
      payload.rule_scope = target === 'additional' ? 'payee' : 'driver';
      if (target === 'additional') {
        payload.payee_id = this.selectedAdditionalPayeeId;
      }
      return this.apiService.createRecurringDeduction(payload);
    });

    this.addingRecurringDeduction = true;
    forkJoin(requests).subscribe({
      next: () => {
        this.showRecurringDeductionModal = false;
        this.resetRecurringDeductionDraft();
        this.loadRecurringDeductions(this.editingDriverId as string);
        this.addingRecurringDeduction = false;
      },
      error: (err: any) => {
        console.error('Error creating recurring deduction:', err);
        alert(err?.error?.error || 'Failed to create recurring deduction.');
        this.addingRecurringDeduction = false;
      }
    });
  }

  openRecurringDeductionModal(): void {
    this.resetRecurringDeductionDraft();
    this.showRecurringDeductionModal = true;
  }

  closeRecurringDeductionModal(): void {
    if (this.addingRecurringDeduction) return;
    this.showRecurringDeductionModal = false;
  }

  onRecurringExpenseCategoryChange(): void {
    const category = this.newRecurringDeduction.expense_category;
    if (!category) return;

    this.newRecurringDeduction.applies_when = 'specific_expense';
    this.newRecurringDeduction.source_type = this.mapExpenseCategoryToSourceType(category);

    const suggested = this.getSuggestedTargetsForSelectedCategory();
    if (suggested.length === 1) {
      this.newRecurringDeduction.target = suggested[0];
    }
  }

  getExpenseResponsibilityForCategory(category: string): string {
    const value = (this.expenseResponsibility[category] || '').toString();
    return value || '—';
  }

  getSuggestedTargetsForSelectedCategory(): Array<'primary' | 'additional'> {
    const category = this.newRecurringDeduction.expense_category;
    if (!category) return [this.newRecurringDeduction.target];

    const responsibility = (this.expenseResponsibility[category] || '').toString();
    if (responsibility === 'shared') return ['primary', 'additional'];
    if (responsibility === 'driver') return ['primary'];
    if (responsibility === 'company' || responsibility === 'owner') return ['additional'];
    return [this.newRecurringDeduction.target];
  }

  getSuggestedTargetsLabel(): string {
    const targets = this.getSuggestedTargetsForSelectedCategory();
    if (targets.length === 2) return 'Primary + Additional payee';
    return targets[0] === 'additional' ? 'Additional payee only' : 'Primary payee only';
  }

  private mapExpenseCategoryToSourceType(category: string): string {
    if (category === 'trailerRent') return 'trailer_rent';
    if (category === 'tolls') return 'toll';
    return category;
  }

  toggleRecurringDeduction(deduction: any): void {
    if (this.savingRecurringDeductionEdit) return;
    const nextEnabled = !deduction.enabled;
    this.apiService.updateRecurringDeduction(deduction.id, { enabled: nextEnabled }).subscribe({
      next: () => {
        deduction.enabled = nextEnabled;
      },
      error: (err: any) => {
        console.error('Error updating recurring deduction:', err);
        alert('Failed to update deduction status.');
      }
    });
  }

  formatRecurringDeductionAmount(deduction: any): string {
    const amount = Number(deduction?.amount || 0);
    if (deduction?.amount_type === 'percentage') {
      return `${amount}%`;
    }
    return `$${amount.toFixed(2)}`;
  }

  getRecurringDeductionTargetLabel(deduction: any): string {
    if (deduction?.rule_scope === 'payee') return 'Additional payee';
    return 'Primary payee';
  }

  getDeductionFrequencyLabel(frequency: string): string {
    const opt = this.deductionFrequencyOptions.find((f) => f.value === frequency);
    return opt ? opt.label : frequency;
  }

  getRecurringDeductionStartDateLabel(deduction: any): string {
    return this.normalizeRecurringDate(deduction?.start_date) || '—';
  }

  getRecurringDeductionEndDateLabel(deduction: any): string {
    return this.normalizeRecurringDate(deduction?.end_date) || 'Ongoing';
  }

  startRecurringDeductionInlineEdit(deduction: any): void {
    this.editingRecurringDeductionId = deduction?.id || null;
    this.editingRecurringDeductionDraft = {
      description: String(deduction?.description || ''),
      amount: Number(deduction?.amount ?? 0),
      start_date: this.normalizeRecurringDate(deduction?.start_date) || new Date().toISOString().slice(0, 10),
      end_date: this.normalizeRecurringDate(deduction?.end_date) || ''
    };
  }

  cancelRecurringDeductionInlineEdit(): void {
    if (this.savingRecurringDeductionEdit) return;
    this.editingRecurringDeductionId = null;
    this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
  }

  saveRecurringDeductionInlineEdit(deduction: any): void {
    this.commitRecurringDeductionInlineEdit(deduction, false);
  }

  saveRecurringDeductionInlineEditAndBackfill(deduction: any): void {
    this.commitRecurringDeductionInlineEdit(deduction, true);
  }

  private commitRecurringDeductionInlineEdit(deduction: any, runBackfillAfterSave: boolean): void {
    if (!deduction?.id) {
      alert('Deduction not found.');
      return;
    }

    if (!this.editingRecurringDeductionDraft.start_date) {
      alert('Start date is required.');
      return;
    }

    if (this.editingRecurringDeductionDraft.amount == null || Number(this.editingRecurringDeductionDraft.amount) <= 0) {
      alert('Amount must be greater than zero.');
      return;
    }

    if (
      this.editingRecurringDeductionDraft.end_date &&
      this.editingRecurringDeductionDraft.end_date < this.editingRecurringDeductionDraft.start_date
    ) {
      alert('End date must be on or after start date.');
      return;
    }

    if (runBackfillAfterSave && (!this.driverBackfill.start_date || !this.driverBackfill.end_date)) {
      alert('Set Start date and End date in Backfill past settlements before using Save + Backfill.');
      return;
    }

    this.savingRecurringDeductionEdit = true;
    this.apiService.updateRecurringDeduction(deduction.id, {
      description: this.editingRecurringDeductionDraft.description.trim() || deduction.description,
      amount: Number(this.editingRecurringDeductionDraft.amount),
      start_date: this.editingRecurringDeductionDraft.start_date,
      end_date: this.editingRecurringDeductionDraft.end_date || undefined
    }).subscribe({
      next: () => {
        deduction.description = this.editingRecurringDeductionDraft.description.trim() || deduction.description;
        deduction.amount = Number(this.editingRecurringDeductionDraft.amount);
        deduction.start_date = this.editingRecurringDeductionDraft.start_date;
        deduction.end_date = this.editingRecurringDeductionDraft.end_date || null;
        this.savingRecurringDeductionEdit = false;
        this.editingRecurringDeductionId = null;
        this.editingRecurringDeductionDraft = { description: '', amount: null, start_date: '', end_date: '' };
        this.updateDriverBackfillWarning();
        if (runBackfillAfterSave) {
          this.runDriverBackfill();
        }
      },
      error: (err: any) => {
        console.error('Error updating recurring deduction:', err);
        alert(err?.error?.error || 'Failed to update deduction.');
        this.savingRecurringDeductionEdit = false;
      }
    });
  }

  runDriverBackfill(): void {
    if (!this.editingDriverId) {
      alert('Open an existing driver to run backfill.');
      return;
    }
    if (!this.driverBackfill.start_date || !this.driverBackfill.end_date) {
      alert('Start date and end date are required.');
      return;
    }
    if (this.driverBackfill.end_date < this.driverBackfill.start_date) {
      alert('End date must be on or after start date.');
      return;
    }

    this.driverBackfilling = true;
    this.driverBackfillResult = null;
    this.updateDriverBackfillWarning();

    this.apiService.backfillRecurringDeductions({
      driver_id: this.editingDriverId,
      start_date: this.driverBackfill.start_date,
      end_date: this.driverBackfill.end_date,
      include_locked: this.driverBackfill.include_locked,
      dry_run: this.driverBackfill.dry_run,
      limit: this.driverBackfill.limit
    }).subscribe({
      next: (res: any) => {
        this.driverBackfillResult = res;
        this.driverBackfilling = false;
      },
      error: (err: any) => {
        console.error('Driver backfill failed:', err);
        alert(err?.error?.error || 'Backfill failed.');
        this.driverBackfilling = false;
      }
    });
  }

  onDriverBackfillDateChange(): void {
    this.updateDriverBackfillWarning();
  }

  private updateDriverBackfillWarning(): void {
    this.driverBackfillWarning = '';
    if (!this.driverBackfill.start_date || !this.driverBackfill.end_date) {
      return;
    }

    const normalizedEnd = this.normalizeRecurringDate(this.driverBackfill.end_date);
    if (!normalizedEnd) {
      return;
    }

    const futureRules = (this.recurringDeductions || [])
      .map((rule: any) => ({ ...rule, normalizedStartDate: this.normalizeRecurringDate(rule?.start_date) }))
      .filter((rule: any) => !!rule.normalizedStartDate && rule.normalizedStartDate > normalizedEnd)
      .sort((left: any, right: any) => String(left.normalizedStartDate).localeCompare(String(right.normalizedStartDate)));

    if (!futureRules.length) {
      return;
    }

    const earliestStart = futureRules[0].normalizedStartDate;
    this.driverBackfillWarning = `${futureRules.length} active scheduled deduction ${futureRules.length === 1 ? 'rule starts' : 'rules start'} after this backfill range. Earliest start date: ${earliestStart}.`;
  }

  private normalizeRecurringDate(value: any): string {
    if (!value) return '';
    const text = String(value);
    const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
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

  // Payee search methods
  onPrimaryPayeeSearchFocus(): void {
        this.showPrimaryPayeeDropdown = true;
        if (this.primaryPayeeSearch.trim()) {
          this.searchPrimaryPayees();
        }
      }

      onPrimaryPayeeSearchBlur(): void {
        setTimeout(() => {
          // Only hide dropdown if we're not about to create a new equipment owner
          if (!this.isCreatingEquipmentOwner) {
            this.showPrimaryPayeeDropdown = false;
          }
        }, 250);
      }

      onPrimaryPayeeSearchInput(): void {
        this.showPrimaryPayeeDropdown = true;
        if (this.primaryPayeeSearch.trim().length >= 2) {
          this.searchPrimaryPayees();
        } else {
          this.filteredPrimaryPayees = [];
        }
      }

  searchPrimaryPayees(): void {
    this.apiService.searchPayees(this.primaryPayeeSearch, 'primary').subscribe({
      next: (res: any) => {
        this.filteredPrimaryPayees = Array.isArray(res.data) ? res.data : [];
      },
      error: (err) => {
        console.error('Failed to search primary payees:', err);
        this.filteredPrimaryPayees = [];
      }
    });
  }

  selectPrimaryPayee(payee: any): void {
    this.selectedPrimaryPayeeId = payee.id;
    this.selectedPrimaryPayeeName = payee.name;
    this.primaryPayeeSearch = payee.name;
    this.newDriver.payableTo = payee.name;
    this.showPrimaryPayeeDropdown = false;
  }

  clearPrimaryPayeeSelection(): void {
    this.selectedPrimaryPayeeId = '';
    this.selectedPrimaryPayeeName = '';
    this.primaryPayeeSearch = '';
    this.newDriver.payableTo = '';
    this.filteredPrimaryPayees = [];
  }

  showCreatePrimaryPayee(): boolean {
    if (!this.primaryPayeeSearch.trim()) return false;
    const query = this.primaryPayeeSearch.toLowerCase();
    return !this.filteredPrimaryPayees.some(p => p.name.toLowerCase() === query);
  }

  onAdditionalPayeeSearchFocus(): void {
    this.showAdditionalPayeeDropdown = true;
    if (this.additionalPayeeSearch.trim()) {
      this.searchAdditionalPayees();
    }
  }

  onAdditionalPayeeSearchBlur(): void {
    setTimeout(() => {
      if (!this.isCreatingEquipmentOwner) {
        this.showAdditionalPayeeDropdown = false;
      }
    }, 250);
  }

  onAdditionalPayeeSearchInput(): void {
    this.showAdditionalPayeeDropdown = true;
    const query = this.additionalPayeeSearch.trim().toLowerCase();
    if (query.length >= 2) {
      // Filter from all payees list - show owner, external_company, contractor types
      this.filteredAdditionalPayees = this.allPayees.filter(p => {
        const isAdditionalPayeeType = ['owner', 'external_company', 'contractor'].includes(p.type);
        const matchesSearch = p.name.toLowerCase().includes(query);
        return isAdditionalPayeeType && matchesSearch;
      }).slice(0, 20); // Limit to 20 results
    } else {
      this.filteredAdditionalPayees = [];
    }
  }

  searchAdditionalPayees(): void {
    // Use local filtering instead of API call
    const query = this.additionalPayeeSearch.trim().toLowerCase();
    this.filteredAdditionalPayees = this.allPayees.filter(p => {
      const isAdditionalPayeeType = ['owner', 'external_company', 'contractor'].includes(p.type);
      const matchesSearch = !query || p.name.toLowerCase().includes(query);
      return isAdditionalPayeeType && matchesSearch;
    }).slice(0, 20);
  }

  selectAdditionalPayee(payee: any): void {
    this.selectedAdditionalPayeeId = payee.id;
    this.selectedAdditionalPayeeName = payee.name;
    this.additionalPayeeSearch = payee.name;
    this.newDriver.additionalPayee = payee.name;
    this.showAdditionalPayeeDropdown = false;
  }

  clearAdditionalPayeeSelection(): void {
    this.selectedAdditionalPayeeId = '';
    this.selectedAdditionalPayeeName = '';
    this.additionalPayeeSearch = '';
    this.newDriver.additionalPayee = '';
    this.filteredAdditionalPayees = [];
  }

  showCreateAdditionalPayee(): boolean {
    if (!this.additionalPayeeSearch.trim()) return false;
    const query = this.additionalPayeeSearch.toLowerCase();
    return !this.filteredAdditionalPayees.some(p => p.name.toLowerCase() === query);
  }

  // Equipment Owner creation methods
  startCreatingEquipmentOwner(): void {
    const prefillName = (this.additionalPayeeSearch || '').trim();
    this.showAdditionalPayeeDropdown = false;
    const urlTree = this.router.createUrlTree(['/settlements/equipment-owners'], {
      queryParams: {
        create: '1',
        prefillName: prefillName || undefined
      }
    });
    const url = this.router.serializeUrl(urlTree);
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) {
      this.router.navigateByUrl(url);
    }
  }

  cancelCreateEquipmentOwner(): void {
    this.isCreatingEquipmentOwner = false;
    this.newEquipmentOwner = {
      companyName: '',
      address: '',
      address2: '',
      email: '',
      phone: '',
      city: '',
      state: '',
      zip: '',
      fidEin: '',
      mc: '',
      notes: '',
      vendorType: '',
      additionalPayee: true,
      equipmentOwner: true,
      additionalPayeeRate: null,
      settlementTemplateType: ''
    };
  }

  createEquipmentOwner(): void {
    if (!this.newEquipmentOwner.companyName.trim() || this.saving) return;

    this.saving = true;

    this.apiService.createEquipmentOwner({
          name: this.newEquipmentOwner.companyName.trim(),
          email: this.newEquipmentOwner.email?.trim() || undefined,
          phone: this.newEquipmentOwner.phone?.trim() || undefined,
          address: this.newEquipmentOwner.address?.trim() || undefined,
          address_line_2: this.newEquipmentOwner.address2?.trim() || undefined,
          city: this.newEquipmentOwner.city?.trim() || undefined,
          state: this.newEquipmentOwner.state?.trim() || undefined,
          zip: this.newEquipmentOwner.zip?.trim() || undefined,
          fid_ein: this.newEquipmentOwner.fidEin?.trim() || undefined,
          mc: this.newEquipmentOwner.mc?.trim() || undefined,
          notes: this.newEquipmentOwner.notes?.trim() || undefined,
          vendor_type: this.newEquipmentOwner.vendorType?.trim() || undefined,
          is_additional_payee: this.newEquipmentOwner.additionalPayee,
          is_equipment_owner: this.newEquipmentOwner.equipmentOwner,
          additional_payee_rate: this.newEquipmentOwner.additionalPayeeRate,
          settlement_template_type: this.newEquipmentOwner.settlementTemplateType || undefined
        }).subscribe({
          next: (res: any) => {
            const newPayee = res?.data || res;
        
            this.filteredAdditionalPayees.push(newPayee);
            this.selectAdditionalPayee(newPayee);
        
            this.isCreatingEquipmentOwner = false;
            this.newEquipmentOwner = {
              companyName: '',
              address: '',
              address2: '',
              email: '',
              phone: '',
              city: '',
              state: '',
              zip: '',
              fidEin: '',
              mc: '',
              notes: '',
              vendorType: '',
              additionalPayee: true,
              equipmentOwner: true,
              additionalPayeeRate: null,
              settlementTemplateType: ''
            };
            this.saving = false;
          },
          error: (err) => {
            alert(err?.error?.error || 'Failed to create equipment owner');
            this.saving = false;
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
      this.apiService.updateDriver(this.editingDriverId, payload).pipe(
        finalize(() => (this.saving = false))
      ).subscribe({
        next: (updated) => {
          // Save payee assignment if payee fields were provided
          this.savePayeeAssignment(this.editingDriverId as string);
          this.loadDrivers();
          this.showNewModal = false;
          this.editingDriverId = null;
        },
        error: (error) => {
          console.error('Error updating driver', error);
          const msg = error?.name === 'TimeoutError' || error?.message?.includes('timeout')
            ? 'Request timed out. The server may be slow—please try again.'
            : 'Failed to update driver. Please try again.';
          alert(msg);
        }
      });
    } else {
      this.apiService.createDriver(payload).subscribe({
        next: (driver) => {
          const createdDriverId = driver?.id || driver?.data?.id;
          if (createdDriverId) {
            this.savePayeeAssignment(createdDriverId);
          }
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

  savePayeeAssignment(driverId: string): void {
    if (!driverId) return;
    
    // Always use driver as primary payee
    const driverName = `${this.newDriver.firstName || ''} ${this.newDriver.lastName || ''}`.trim() || 'Driver';
    const hasAdditionalPayee = this.selectedAdditionalPayeeId || this.additionalPayeeSearch.trim();

    const payload: any = {
      primary_payee_name: driverName,
      primary_payee_type: 'driver'
    };
    
    if (this.selectedAdditionalPayeeId) {
      payload.additional_payee_id = this.selectedAdditionalPayeeId;
    } else if (this.additionalPayeeSearch.trim()) {
      payload.additional_payee_name = this.additionalPayeeSearch.trim();
      payload.additional_payee_type = 'owner';
    }
    
    if (this.newDriver.payeeReason) {
      payload.rule_type = this.newDriver.payeeReason;
    }
    
    if (this.newDriver.effectiveStart) {
      payload.effective_start_date = this.newDriver.effectiveStart;
    }
    
    if (this.newDriver.effectiveEnd) {
      payload.effective_end_date = this.newDriver.effectiveEnd;
    }

    this.apiService.resolveDriverPayeeAssignment(driverId, payload).subscribe({
      next: () => {
        console.log('Payee assignment saved successfully');
        // Also save expense responsibility if provided
        this.saveExpenseResponsibility(driverId);
      },
      error: (err: any) => {
        console.error('Failed to save payee assignment:', err);
      }
    });
  }

  saveExpenseResponsibility(driverId: string): void {
    if (!driverId) return;

    // Check if any expense responsibility is set
    const hasExpenseData = Object.values(this.expenseResponsibility).some(v => v && v.trim());
    if (!hasExpenseData) return;

    const payload: any = {
      fuel_responsibility: this.expenseResponsibility['fuel'] || null,
      insurance_responsibility: this.expenseResponsibility['insurance'] || null,
      eld_responsibility: this.expenseResponsibility['eld'] || null,
      trailer_rent_responsibility: this.expenseResponsibility['trailerRent'] || null,
      toll_responsibility: this.expenseResponsibility['tolls'] || null,
      repairs_responsibility: this.expenseResponsibility['repairs'] || null,
      effective_start_date: this.newDriver.effectiveStart || new Date().toISOString().slice(0, 10),
      effective_end_date: this.newDriver.effectiveEnd || null
    };

    this.apiService.saveExpenseResponsibility(driverId, payload).subscribe({
      next: () => {
        console.log('Expense responsibility saved successfully');
      },
      error: (err: any) => {
        console.error('Failed to save expense responsibility:', err);
      }
    });
  }

}

