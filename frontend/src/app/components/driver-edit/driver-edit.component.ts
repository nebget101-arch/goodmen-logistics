import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';

type PayTab = 'rates' | 'deductions' | 'payee' | 'notes';

@Component({
  selector: 'app-driver-edit',
  templateUrl: './driver-edit.component.html',
  styleUrls: ['./driver-edit.component.scss']
})
export class DriverEditComponent implements OnInit, OnDestroy {
  driverId: string | null = null;

  loadingDriver = true;
  notFound = false;
  saving = false;

  driver: any = this.emptyDriver();
  trucks: any[] = [];
  trailers: any[] = [];
  drivers: any[] = []; // used by availableTrailers to filter out already-assigned trailers

  truckSelectOptions: { value: string; label: string }[] = [];
  trailerSelectOptions: { value: string; label: string }[] = [];

  payTab: PayTab = 'rates';

  /** Payee state */
  allPayees: any[] = [];
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

  isCreatingEquipmentOwner = false;
  equipmentOwnerAutoPopulated = false;
  pendingOwnerChange: { truckId: string; ownerName: string } | null = null;

  /** Expense responsibility state */
  expenseResponsibility: Record<string, string> = {
    fuel: '', insurance: '', eld: '', trailerRent: '', tolls: '', repairs: ''
  };
  expenseProfile: any = null;
  expenseSplitType = '';
  sharedExpensePercentages: Record<string, number> = { fuel: 50, tolls: 50, repairs: 50 };
  sharedExpenseFixedAmounts: Record<string, { driver: number; owner: number }> = {
    insurance: { driver: 0, owner: 0 },
    eld: { driver: 0, owner: 0 },
    trailerRent: { driver: 0, owner: 0 }
  };

  readonly expenseKeys: { key: string; label: string }[] = [
    { key: 'fuel', label: 'Fuel' },
    { key: 'insurance', label: 'Insurance' },
    { key: 'eld', label: 'ELD' },
    { key: 'trailerRent', label: 'Trailer rent' },
    { key: 'tolls', label: 'Tolls' },
    { key: 'repairs', label: 'Repairs' }
  ];

  readonly variableExpenseKeys: { key: string; label: string }[] = [
    { key: 'fuel', label: 'Fuel' },
    { key: 'tolls', label: 'Tolls' },
    { key: 'repairs', label: 'Repairs' }
  ];

  readonly fixedExpenseKeys: { key: string; label: string }[] = [
    { key: 'insurance', label: 'Insurance' },
    { key: 'eld', label: 'ELD' },
    { key: 'trailerRent', label: 'Trailer Rent' }
  ];

  readonly responsibilityOptions = [
    { value: '', label: '---' },
    { value: 'driver', label: 'Driver' },
    { value: 'equipment_owner', label: 'Equipment Owner' },
    { value: 'shared', label: 'Shared' }
  ];

  readonly driverTypeOptions = [
    { value: 'driver', label: 'Driver' },
    { value: 'owner_operator', label: 'Owner Operator' }
  ];

  readonly driverStatusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'applicant', label: 'Applicant' }
  ];

  readonly cdlClassOptions = [
    { value: 'A', label: 'Class A' },
    { value: 'B', label: 'Class B' },
    { value: 'C', label: 'Class C' }
  ];

  readonly deductionTargetOptions = [
    { value: 'primary', label: 'Driver' },
    { value: 'additional', label: 'Equipment Owner' }
  ];

  readonly deductionAmountTypeOptions = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'percentage', label: 'Percentage' }
  ];

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

  readonly sourceTypeOptions = [
    { value: '', label: 'Select expense' },
    { value: 'fuel', label: 'Fuel' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'eld', label: 'ELD' },
    { value: 'trailer_rent', label: 'Trailer rent' },
    { value: 'toll', label: 'Tolls' },
    { value: 'repairs', label: 'Repairs' }
  ];

  readonly expenseCategoryOptions = [
    { value: '', label: 'Manual / not expense-specific' },
    ...this.expenseKeys.map(e => ({ value: e.key, label: e.label }))
  ];

  /** Recurring deductions */
  recurringDeductions: any[] = [];
  loadingRecurringDeductions = false;
  addingRecurringDeduction = false;
  editingRecurringDeductionId: string | null = null;
  editingRecurringDeductionDraft: {
    description: string;
    amount: number | null;
    start_date: string;
    end_date: string;
  } = { description: '', amount: null, start_date: '', end_date: '' };
  savingRecurringDeductionEdit = false;
  showRecurringDeductionModal = false;
  deductionAmountDirty = false;

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

  /** Backfill */
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

  private destroy$ = new Subject<void>();

  constructor(
    private apiService: ApiService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      this.driverId = id;
      this.loadAll();
    });
    this.loadAllPayees();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private emptyDriver(): any {
    return {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      status: 'applicant',
      applicationDate: '',
      dateOfBirth: '',
      driverType: 'driver',
      payBasis: 'per_mile',
      payRate: null,
      payPercentage: null,
      equipmentOwnerPercentage: null,
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
      truckUnitNumber: '',
      trailerUnitNumber: '',
      fuelCardNumber: ''
    };
  }

  private loadAll(): void {
    if (!this.driverId) {
      this.notFound = true;
      this.loadingDriver = false;
      return;
    }
    this.loadingDriver = true;
    this.notFound = false;

    // Load vehicles in parallel — needed for truck/trailer selectors and trailer-availability filter.
    this.loadVehicles();
    this.loadDriversForTrailerFilter();

    this.apiService.getDriver(this.driverId).subscribe({
      next: (detail: any) => {
        if (!detail || (detail && detail.id == null && detail.driver == null)) {
          this.notFound = true;
          this.loadingDriver = false;
          return;
        }
        const source = detail?.driver || detail;
        this.driver = this.buildDriverFromSource(source);
        this.primaryPayeeSearch = this.driver.payableTo || '';
        this.additionalPayeeSearch = this.driver.additionalPayee || '';
        this.selectedPrimaryPayeeId = source?.primaryPayeeId || '';
        this.selectedAdditionalPayeeId = source?.additionalPayeeId || '';
        this.ensureTruckTrailerOptionsForForm();

        if (
          source?.fuelResponsibility ||
          source?.insuranceResponsibility ||
          source?.eldResponsibility ||
          source?.trailerRentResponsibility ||
          source?.tollResponsibility ||
          source?.repairsResponsibility
        ) {
          this.expenseResponsibility = {
            fuel: source.fuelResponsibility || '',
            insurance: source.insuranceResponsibility || '',
            eld: source.eldResponsibility || '',
            trailerRent: source.trailerRentResponsibility || '',
            tolls: source.tollResponsibility || '',
            repairs: source.repairsResponsibility || ''
          };
        }

        this.loadingDriver = false;
        this.loadPayeeAssignment();
        this.loadExpenseResponsibility();
        this.loadRecurringDeductions();
      },
      error: (err: any) => {
        if (err?.status === 404) {
          this.notFound = true;
        } else {
          console.error('Error loading driver', err);
          this.notFound = true;
        }
        this.loadingDriver = false;
      }
    });
  }

  private loadVehicles(): void {
    this.apiService.getVehicles().subscribe({
      next: (all: any) => {
        const list = Array.isArray(all)
          ? all
          : Array.isArray(all?.data)
            ? all.data
            : Array.isArray(all?.rows)
              ? all.rows
              : [];
        this.trucks = list.filter((v: any) => {
          const t = (v.vehicle_type || v.vehicleType || '').toString().toLowerCase();
          return t !== 'trailer';
        });
        this.trailers = list.filter((v: any) => {
          const t = (v.vehicle_type || v.vehicleType || '').toString().toLowerCase();
          return t === 'trailer';
        });
        const truckLabel = (t: any) =>
          [t.unit_number ?? t.unitNumber, t.make, t.model].filter(Boolean).join(' - ') ||
          String(t.id ?? '');
        this.truckSelectOptions = this.trucks.map((t) => ({
          value: this.normalizeId(t.id),
          label: truckLabel(t)
        }));
        this.trailerSelectOptions = this.trailers.map((t) => ({
          value: this.normalizeId(t.id),
          label: truckLabel(t)
        }));
        this.ensureTruckTrailerOptionsForForm();
      },
      error: () => {
        this.trucks = [];
        this.trailers = [];
        this.truckSelectOptions = [];
        this.trailerSelectOptions = [];
      }
    });
  }

  private loadDriversForTrailerFilter(): void {
    this.apiService.getDispatchDrivers().subscribe({
      next: (data: any) => {
        this.drivers = Array.isArray(data) ? data : [];
      },
      error: () => {
        this.drivers = [];
      }
    });
  }

  private loadAllPayees(): void {
    this.apiService.getAllPayees({ is_active: true, limit: 200 }).subscribe({
      next: (payees: any) => {
        this.allPayees = payees || [];
      },
      error: () => {
        this.allPayees = [];
      }
    });
  }

  private loadPayeeAssignment(): void {
    if (!this.driverId) return;
    this.apiService.getPayeeAssignment(this.driverId).subscribe({
      next: (response: any) => {
        const assignment = response?.assignment || response;
        const additionalPayee = response?.additional_payee;

        if (assignment?.primary_payee_id) {
          this.selectedPrimaryPayeeId = assignment.primary_payee_id;
        }

        if (assignment?.additional_payee_id && additionalPayee) {
          this.selectedAdditionalPayeeId = assignment.additional_payee_id;
          this.additionalPayeeSearch = additionalPayee.name;
          this.selectedAdditionalPayeeName = additionalPayee.name;
        }

        if (assignment?.effective_start_date) {
          this.driver.effectiveStart = assignment.effective_start_date;
        }
        if (assignment?.effective_end_date) {
          this.driver.effectiveEnd = assignment.effective_end_date;
        }
      },
      error: (err: any) => {
        if (err?.status !== 404) {
          console.error('Error loading payee assignment:', err);
        }
      }
    });
  }

  private loadExpenseResponsibility(): void {
    if (!this.driverId) return;
    this.apiService.getExpenseResponsibility(this.driverId).subscribe({
      next: (expense: any) => {
        if (!expense) return;
        this.expenseProfile = expense;
        this.expenseResponsibility = {
          fuel: expense.fuel_responsibility || '',
          insurance: expense.insurance_responsibility || '',
          eld: expense.eld_responsibility || '',
          trailerRent: expense.trailer_rent_responsibility || '',
          tolls: expense.toll_responsibility || '',
          repairs: expense.repairs_responsibility || ''
        };
        this.expenseSplitType = expense.split_type || '';
        const rules = expense.custom_rules || {};
        if (rules.percentages) {
          this.sharedExpensePercentages = { fuel: 50, tolls: 50, repairs: 50, ...rules.percentages };
        }
        if (rules.fixedAmounts) {
          this.sharedExpenseFixedAmounts = {
            insurance: { driver: 0, owner: 0 },
            eld: { driver: 0, owner: 0 },
            trailerRent: { driver: 0, owner: 0 },
            ...rules.fixedAmounts
          };
        }
      },
      error: () => {}
    });
  }

  loadRecurringDeductions(): void {
    if (!this.driverId) return;
    this.loadingRecurringDeductions = true;
    const payeeIds = [this.selectedPrimaryPayeeId, this.selectedAdditionalPayeeId].filter(Boolean);
    this.apiService.getRecurringDeductions({ driver_id: this.driverId, payee_ids: payeeIds }).subscribe({
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
        this.loadingRecurringDeductions = false;
      }
    });
  }

  setPayTab(tab: PayTab): void {
    this.payTab = tab;
    if (tab === 'deductions') {
      this.loadRecurringDeductions();
    }
  }

  setPayModel(model: string): void {
    this.driver.payModel = model;
    if (model === 'per_mile') this.driver.payBasis = 'per_mile';
    else if (model === 'percentage') this.driver.payBasis = 'percentage';
    else this.driver.payBasis = 'flatpay';
  }

  onDriverTypeChange(): void {
    if (this.driver.driverType === 'owner_operator') {
      this.driver.payBasis = 'percentage';
      this.driver.payModel = 'percentage';
      this.driver.payRate = null;
      this.driver.equipmentOwnerPercentage = null;
      this.expenseSplitType = 'equipment_owner';
      for (const e of this.expenseKeys) {
        this.expenseResponsibility = { ...this.expenseResponsibility, [e.key]: 'equipment_owner' };
      }
    } else {
      this.expenseSplitType = '';
    }
  }

  onExpenseSplitTypeChange(splitType: string): void {
    this.expenseSplitType = splitType;
    if (splitType === 'driver') {
      for (const e of this.expenseKeys) {
        this.expenseResponsibility = { ...this.expenseResponsibility, [e.key]: 'driver' };
      }
    } else if (splitType === 'equipment_owner') {
      for (const e of this.expenseKeys) {
        this.expenseResponsibility = { ...this.expenseResponsibility, [e.key]: 'equipment_owner' };
      }
    }
  }

  get showExpenseSection(): boolean {
    return this.driver.payModel === 'percentage';
  }

  get companyRetainsPercentage(): number {
    const driverPct = Number(this.driver.payPercentage) || 0;
    const eo = Number(this.driver.equipmentOwnerPercentage) || 0;
    return Math.round((100 - driverPct - eo) * 100) / 100;
  }

  get percentageSumExceeds100(): boolean {
    const driverPct = Number(this.driver.payPercentage) || 0;
    const eo = Number(this.driver.equipmentOwnerPercentage) || 0;
    return (driverPct + eo) > 100;
  }

  /** Available trailers — filter out trailers assigned to other drivers. */
  get availableTrailers(): any[] {
    const assignedToOtherDrivers = new Set<string>();
    (this.drivers || []).forEach((d: any) => {
      const driverId = this.normalizeId(d?.id);
      if (this.driverId && driverId === this.normalizeId(this.driverId)) return;
      const trailerId = this.normalizeId(d?.trailerId ?? d?.trailer_id);
      if (trailerId) assignedToOtherDrivers.add(trailerId);
    });

    const selectedTrailerId = this.normalizeId(this.driver?.trailerId);
    return (this.trailers || []).filter((tr: any) => {
      const id = this.normalizeId(tr?.id);
      if (!id) return false;
      if (selectedTrailerId && id === selectedTrailerId) return true;
      return !assignedToOtherDrivers.has(id);
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
      driverType: source.driverType || 'driver',
      payBasis: source.payBasis || 'per_mile',
      payRate: source.payRate ?? null,
      payPercentage: source.payPercentage ?? null,
      equipmentOwnerPercentage: source.equipmentOwnerPercentage ?? source.equipment_owner_percentage ?? null,
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
      coDriverId: source.coDriverId || source.co_driver_id || '',
      truckId: this.normalizeId(source.truckId ?? source.truck_id ?? ''),
      trailerId: this.normalizeId(source.trailerId ?? source.trailer_id ?? ''),
      truckUnitNumber: source.truckUnitNumber || source.truck_unit_number || '',
      trailerUnitNumber: source.trailerUnitNumber || source.trailer_unit_number || '',
      fuelCardNumber: source.fuelCardNumber || source.fuel_card_number || ''
    };
  }

  private normalizeId(value: any): string {
    return (value ?? '').toString().trim();
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  private ensureTruckTrailerOptionsForForm(): void {
    const tid = this.normalizeId(this.driver?.truckId);
    if (tid) {
      const exists = this.truckSelectOptions.some((o) => this.normalizeId(o.value) === tid);
      if (!exists) {
        const label = [this.driver?.truckUnitNumber, 'Truck'].filter(Boolean).join(' — ') || tid;
        this.truckSelectOptions = [...this.truckSelectOptions, { value: tid, label }];
      }
    }
    const trid = this.normalizeId(this.driver?.trailerId);
    if (trid) {
      const exists = this.trailerSelectOptions.some((o) => this.normalizeId(o.value) === trid);
      if (!exists) {
        const label = [this.driver?.trailerUnitNumber, 'Trailer'].filter(Boolean).join(' — ') || trid;
        this.trailerSelectOptions = [...this.trailerSelectOptions, { value: trid, label }];
      }
    }
  }

  /** Truck/trailer selection */
  onTruckSelected(truckId: string | null): void {
    const tid = this.normalizeId(truckId);
    const truck = tid ? (this.trucks || []).find((t: any) => this.normalizeId(t.id) === tid) : undefined;
    if (!tid) {
      this.driver.truckUnitNumber = '';
    } else {
      const unit = truck?.unit_number ?? truck?.unitNumber;
      if (unit != null && unit !== '') this.driver.truckUnitNumber = String(unit);
    }
    const ownerName = (truck?.equipment_owner_name || '').trim();
    if (!ownerName) {
      this.equipmentOwnerAutoPopulated = false;
      return;
    }
    const currentOwner = (this.additionalPayeeSearch || '').trim();
    if (currentOwner && currentOwner !== ownerName) {
      this.pendingOwnerChange = { truckId: tid, ownerName };
      return;
    }
    this.applyEquipmentOwnerFromTruck(ownerName);
  }

  onTrailerSelected(trailerId: string | null): void {
    const id = this.normalizeId(trailerId);
    if (!id) {
      this.driver.trailerUnitNumber = '';
      return;
    }
    const tr = (this.trailers || []).find((t: any) => this.normalizeId(t.id) === id);
    const unit = tr?.unit_number ?? tr?.unitNumber;
    if (unit != null && unit !== '') this.driver.trailerUnitNumber = String(unit);
  }

  confirmOwnerChange(): void {
    if (!this.pendingOwnerChange) return;
    this.applyEquipmentOwnerFromTruck(this.pendingOwnerChange.ownerName);
    this.pendingOwnerChange = null;
  }

  cancelOwnerChange(): void {
    if (this.pendingOwnerChange) {
      const prev = this.trucks.find(
        (t: any) => (t.equipment_owner_name || '').trim() === (this.additionalPayeeSearch || '').trim()
      );
      this.driver.truckId = this.normalizeId(prev?.id);
      const u = prev?.unit_number ?? prev?.unitNumber;
      this.driver.truckUnitNumber = u != null && u !== '' ? String(u) : '';
    }
    this.pendingOwnerChange = null;
  }

  private applyEquipmentOwnerFromTruck(ownerName: string): void {
    this.additionalPayeeSearch = ownerName;
    this.driver.additionalPayee = ownerName;
    this.selectedAdditionalPayeeId = '';
    this.selectedAdditionalPayeeName = ownerName;
    this.equipmentOwnerAutoPopulated = true;
    this.filteredAdditionalPayees = [];
  }

  /** Payee search */
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
      this.filteredAdditionalPayees = this.allPayees.filter((p: any) => {
        const isAdditionalPayeeType = ['owner', 'external_company', 'contractor'].includes(p.type);
        const matchesSearch = p.name.toLowerCase().includes(query);
        return isAdditionalPayeeType && matchesSearch;
      }).slice(0, 20);
    } else {
      this.filteredAdditionalPayees = [];
    }
  }

  searchAdditionalPayees(): void {
    const query = this.additionalPayeeSearch.trim().toLowerCase();
    this.filteredAdditionalPayees = this.allPayees.filter((p: any) => {
      const isAdditionalPayeeType = ['owner', 'external_company', 'contractor'].includes(p.type);
      const matchesSearch = !query || p.name.toLowerCase().includes(query);
      return isAdditionalPayeeType && matchesSearch;
    }).slice(0, 20);
  }

  selectAdditionalPayee(payee: any): void {
    this.selectedAdditionalPayeeId = payee.id;
    this.selectedAdditionalPayeeName = payee.name;
    this.additionalPayeeSearch = payee.name;
    this.driver.additionalPayee = payee.name;
    this.showAdditionalPayeeDropdown = false;
  }

  clearAdditionalPayeeSelection(): void {
    this.selectedAdditionalPayeeId = '';
    this.selectedAdditionalPayeeName = '';
    this.additionalPayeeSearch = '';
    this.driver.additionalPayee = '';
    this.filteredAdditionalPayees = [];
    this.equipmentOwnerAutoPopulated = false;
  }

  showCreateAdditionalPayee(): boolean {
    if (!this.additionalPayeeSearch.trim()) return false;
    const query = this.additionalPayeeSearch.toLowerCase();
    return !this.filteredAdditionalPayees.some((p: any) => p.name.toLowerCase() === query);
  }

  startCreatingEquipmentOwner(): void {
    const prefillName = (this.additionalPayeeSearch || '').trim();
    this.showAdditionalPayeeDropdown = false;
    const urlTree = this.router.createUrlTree(['/settlements/equipment-owners'], {
      queryParams: { create: '1', prefillName: prefillName || undefined }
    });
    const url = this.router.serializeUrl(urlTree);
    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) {
      this.router.navigateByUrl(url);
    }
  }

  /** Recurring deductions */
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
    this.deductionAmountDirty = false;
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

    const fixedCategories = new Set(['insurance', 'eld', 'trailerRent']);
    if (fixedCategories.has(category) && this.expenseProfile) {
      const isDriver = this.newRecurringDeduction.target === 'primary';
      const perCategory = this.sharedExpenseFixedAmounts[category];
      const autoAmount = perCategory
        ? (isDriver ? Number(perCategory.driver) || 0 : Number(perCategory.owner) || 0)
        : 0;
      this.newRecurringDeduction.amount = autoAmount || null;
      this.deductionAmountDirty = false;
    }

    const isVariable = this.variableExpenseKeys.some(v => v.key === category);
    if (isVariable) {
      this.newRecurringDeduction.amount_type = 'percentage';
      const effectiveTarget = suggested.length === 1 ? suggested[0] : this.newRecurringDeduction.target;
      const driverShare = this.sharedExpensePercentages[category] ?? 50;
      this.newRecurringDeduction.amount = effectiveTarget === 'additional'
        ? 100 - driverShare
        : driverShare;
      this.deductionAmountDirty = false;
    }
  }

  onDeductionAmountInput(): void {
    this.deductionAmountDirty = true;
  }

  onDeductionTargetChange(): void {
    const category = this.newRecurringDeduction.expense_category;
    if (!category || !this.expenseProfile) return;

    const isDriver = this.newRecurringDeduction.target === 'primary';
    const fixedCategories = new Set(['insurance', 'eld', 'trailerRent']);
    const variableCategories = new Set(['fuel', 'tolls', 'repairs']);

    let configuredAmount: number | null = null;
    if (fixedCategories.has(category)) {
      const perCategory = this.sharedExpenseFixedAmounts[category];
      configuredAmount = perCategory
        ? (isDriver ? Number(perCategory.driver) || 0 : Number(perCategory.owner) || 0)
        : 0;
    } else if (variableCategories.has(category)) {
      const driverPct = this.sharedExpensePercentages[category] ?? 50;
      configuredAmount = isDriver ? driverPct : Math.max(0, 100 - driverPct);
    }

    if (configuredAmount === null) return;

    if (this.deductionAmountDirty) {
      if (confirm('Reset to configured amount?')) {
        this.newRecurringDeduction.amount = configuredAmount || null;
        this.deductionAmountDirty = false;
      }
    } else {
      this.newRecurringDeduction.amount = configuredAmount || null;
    }
  }

  private mapExpenseCategoryToSourceType(category: string): string {
    if (category === 'trailerRent') return 'trailer_rent';
    if (category === 'tolls') return 'toll';
    return category;
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
    if (targets.length === 2) return 'Driver + Equipment Owner';
    return targets[0] === 'additional' ? 'Equipment Owner only' : 'Driver only';
  }

  addRecurringDeduction(): void {
    if (!this.driverId) return;
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
      alert('Select an additional payee first in the Equipment Owner tab.');
      return;
    }

    const basePayload: any = {
      driver_id: this.driverId,
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
        this.loadRecurringDeductions();
        this.addingRecurringDeduction = false;
      },
      error: (err: any) => {
        console.error('Error creating recurring deduction:', err);
        alert(err?.error?.error || 'Failed to create recurring deduction.');
        this.addingRecurringDeduction = false;
      }
    });
  }

  toggleRecurringDeduction(deduction: any): void {
    if (this.savingRecurringDeductionEdit) return;
    const nextEnabled = !deduction.enabled;
    this.apiService.updateRecurringDeduction(deduction.id, { enabled: nextEnabled }).subscribe({
      next: () => {
        deduction.enabled = nextEnabled;
      },
      error: () => {
        alert('Failed to update deduction status.');
      }
    });
  }

  formatRecurringDeductionAmount(deduction: any): string {
    const amount = Number(deduction?.amount || 0);
    if (deduction?.amount_type === 'percentage') return `${amount}%`;
    return `$${amount.toFixed(2)}`;
  }

  getRecurringDeductionTargetLabel(deduction: any): string {
    return deduction?.rule_scope === 'payee' ? 'Equipment Owner' : 'Driver';
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
        if (runBackfillAfterSave) this.runDriverBackfill();
      },
      error: (err: any) => {
        console.error('Error updating recurring deduction:', err);
        alert(err?.error?.error || 'Failed to update deduction.');
        this.savingRecurringDeductionEdit = false;
      }
    });
  }

  runDriverBackfill(): void {
    if (!this.driverId) return;
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
      driver_id: this.driverId,
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
    if (!this.driverBackfill.start_date || !this.driverBackfill.end_date) return;
    const normalizedEnd = this.normalizeRecurringDate(this.driverBackfill.end_date);
    if (!normalizedEnd) return;

    const futureRules = (this.recurringDeductions || [])
      .map((rule: any) => ({ ...rule, normalizedStartDate: this.normalizeRecurringDate(rule?.start_date) }))
      .filter((rule: any) => !!rule.normalizedStartDate && rule.normalizedStartDate > normalizedEnd)
      .sort((left: any, right: any) => String(left.normalizedStartDate).localeCompare(String(right.normalizedStartDate)));

    if (!futureRules.length) return;

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

  /** Save / cancel */
  cancel(): void {
    this.router.navigate(['/drivers']);
  }

  saveDriver(): void {
    if (!this.driverId) return;
    if (!this.driver.firstName || !this.driver.lastName || !this.driver.cdlNumber || !this.driver.cdlState) {
      alert('First name, last name, CDL number, and CDL state are required.');
      return;
    }

    this.saving = true;

    const payload: any = { ...this.driver };
    delete payload.truckUnitNumber;
    delete payload.trailerUnitNumber;
    if (payload.driverType === 'company' || payload.driverType === 'company_driver') {
      payload.driverType = 'driver';
    }
    const pm = (this.driver.payModel || this.driver.payBasis || 'per_mile').toString();
    if (pm === 'flat_weekly' && this.driver.flatWeeklyAmount != null) {
      payload.payBasis = 'flatpay';
      payload.payRate = this.driver.flatWeeklyAmount;
    } else if (pm === 'flat_per_load' && this.driver.flatPerLoadAmount != null) {
      payload.payBasis = 'flatpay';
      payload.payRate = this.driver.flatPerLoadAmount;
    }
    delete payload.payModel;
    delete payload.flatWeeklyAmount;
    delete payload.flatPerLoadAmount;
    delete payload.additionalPayee;
    delete payload.payeeReason;
    delete payload.effectiveStart;
    delete payload.effectiveEnd;
    delete payload.compensationNotes;

    this.apiService.updateDriver(this.driverId, payload).pipe(
      finalize(() => (this.saving = false))
    ).subscribe({
      next: () => {
        this.savePayeeAssignment(this.driverId as string);
        this.saveExpenseResponsibility(this.driverId as string);
        this.router.navigate(['/drivers']);
      },
      error: (err: any) => {
        console.error('Error updating driver', err);
        const msg = err?.name === 'TimeoutError' || err?.message?.includes('timeout')
          ? 'Request timed out. The server may be slow—please try again.'
          : 'Failed to update driver. Please try again.';
        alert(msg);
      }
    });
  }

  private savePayeeAssignment(driverId: string): void {
    if (!driverId) return;
    const driverName = `${this.driver.firstName || ''} ${this.driver.lastName || ''}`.trim() || 'Driver';

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

    if (this.driver.payeeReason) payload.rule_type = this.driver.payeeReason;
    if (this.driver.effectiveStart) payload.effective_start_date = this.driver.effectiveStart;
    if (this.driver.effectiveEnd) payload.effective_end_date = this.driver.effectiveEnd;

    this.apiService.resolveDriverPayeeAssignment(driverId, payload).subscribe({
      error: (err: any) => {
        console.error('Failed to save payee assignment:', err);
      }
    });
  }

  private saveExpenseResponsibility(driverId: string): void {
    if (!driverId) return;
    const hasExpenseData = Object.values(this.expenseResponsibility).some(v => v && v.trim());
    if (!hasExpenseData) return;

    const payload: any = {
      fuel_responsibility: this.expenseResponsibility['fuel'] || null,
      insurance_responsibility: this.expenseResponsibility['insurance'] || null,
      eld_responsibility: this.expenseResponsibility['eld'] || null,
      trailer_rent_responsibility: this.expenseResponsibility['trailerRent'] || null,
      toll_responsibility: this.expenseResponsibility['tolls'] || null,
      repairs_responsibility: this.expenseResponsibility['repairs'] || null,
      effective_start_date: this.driver.effectiveStart || new Date().toISOString().slice(0, 10),
      effective_end_date: this.driver.effectiveEnd || null,
      split_type: this.expenseSplitType || null,
      driver_percentage: this.expenseSplitType === 'shared'
        ? Math.round(((this.sharedExpensePercentages['fuel'] ?? 50) + (this.sharedExpensePercentages['tolls'] ?? 50) + (this.sharedExpensePercentages['repairs'] ?? 50)) / 3)
        : null,
      custom_rules: this.expenseSplitType === 'shared'
        ? { percentages: { ...this.sharedExpensePercentages }, fixedAmounts: { ...this.sharedExpenseFixedAmounts } }
        : null
    };

    this.apiService.saveExpenseResponsibility(driverId, payload).subscribe({
      error: (err: any) => {
        console.error('Failed to save expense responsibility:', err);
      }
    });
  }
}
