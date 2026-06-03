import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-dispatch-drivers',
  templateUrl: './dispatch-drivers.component.html',
  styleUrls: ['./dispatch-drivers.component.css']
})
export class DispatchDriversComponent implements OnInit, OnDestroy {
  drivers: any[] = [];
  loading = true;

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

  readonly driverTypeOptions = [
    { value: 'driver', label: 'Driver' },
    { value: 'owner_operator', label: 'Owner Operator' }
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

  activeOperatingEntityName = '';
  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private router: Router,
    private operatingEntityContext: OperatingEntityContextService
  ) {}

  ngOnInit(): void {
    this.bindOperatingEntityContext();
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
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.drivers = [];
          this.loadDrivers();
        }
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

  goToEdit(driver: any): void {
    if (!driver?.id) return;
    this.router.navigate(['/drivers', driver.id, 'edit']);
  }

  hasActiveFilter(): boolean {
    return Object.values(this.driverFilters).some(v => v && String(v).trim());
  }

  clearFilters(): void {
    this.driverFilters = {
      name: '', type: '', status: '', hireDate: '',
      phone: '', email: '', truck: '', trailer: '',
      payBasis: '', payRate: ''
    };
  }

  formatDateOnly(value: any): string {
    return this.normalizeDate(value);
  }

  getDriverTypeLabel(type: string): string {
    const t = (type || '').toString();
    if (t === 'owner_operator') return 'Owner Operator';
    if (t === 'company_driver' || t === 'company' || t === 'driver') return 'Driver';
    return 'Driver';
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
}
