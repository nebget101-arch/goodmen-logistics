import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import {
  DriverOption,
  EquipmentOption,
  LoadsService,
} from '../../../../services/loads.service';
import { LoadWizardMode } from '../../load-wizard.component';

/**
 * FN-865 / FN-879 — Step 3 (Driver & Equipment) sub-component for
 * `<app-load-wizard-v2>`. Renders three autocomplete combos bound to the
 * parent wizard's `driverEquipment` FormGroup (`driverId`, `truckId`,
 * `trailerId`, `showAllTrucks`).
 *
 * Driver list is fed by `LoadsService.getActiveDrivers()`. Selecting a driver
 * auto-fills the assigned truck + trailer (user can override). Truck list is
 * filtered to the driver's assigned truck by default; the "Show all trucks"
 * toggle swaps the list source to the full fleet. Trailer is optional and
 * clearable. `canProceed` in the shell requires driver + truck only — this
 * component installs `Validators.required` on those two controls.
 */

interface TruckOption extends EquipmentOption {
  equipment_owner?: string | null;
  equipment_owner_id?: string | null;
}

@Component({
  selector: 'app-load-wizard-driver-equipment',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './driver-equipment.component.html',
  styleUrls: ['./driver-equipment.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadWizardDriverEquipmentComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) driverEquipment!: FormGroup;
  @Input() mode: LoadWizardMode = 'create';

  drivers: DriverOption[] = [];
  trucks: TruckOption[] = [];
  trailers: EquipmentOption[] = [];

  loadingDrivers = false;
  loadingTrucks = false;
  loadingTrailers = false;

  driverSearch = '';
  truckSearch = '';
  trailerSearch = '';

  driverDropdownOpen = false;
  truckDropdownOpen = false;
  trailerDropdownOpen = false;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private loadsService: LoadsService,
    private cdr: ChangeDetectorRef,
    private elRef: ElementRef,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.applyValidators();
    this.applyModeState();
    this.loadData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['mode'] && !changes['mode'].firstChange) {
      this.applyModeState();
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Form setup ─────────────────────────────────────────────────────────

  private applyValidators(): void {
    const driverId = this.driverEquipment.get('driverId');
    if (driverId && !driverId.hasValidator(Validators.required)) {
      driverId.addValidators(Validators.required);
      driverId.updateValueAndValidity({ emitEvent: false });
    }

    const truckId = this.driverEquipment.get('truckId');
    if (truckId && !truckId.hasValidator(Validators.required)) {
      truckId.addValidators(Validators.required);
      truckId.updateValueAndValidity({ emitEvent: false });
    }
  }

  private applyModeState(): void {
    if (this.mode === 'view') {
      this.driverEquipment.disable({ emitEvent: false });
    } else {
      this.driverEquipment.enable({ emitEvent: false });
    }
  }

  isView(): boolean {
    return this.mode === 'view';
  }

  // ─── Data loading ───────────────────────────────────────────────────────

  private loadData(): void {
    this.loadingDrivers = true;
    this.loadsService
      .getActiveDrivers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (list) => {
          this.drivers = list || [];
          this.loadingDrivers = false;
          this.syncDriverSearchFromValue();
          this.cdr.markForCheck();
        },
        error: () => {
          this.drivers = [];
          this.loadingDrivers = false;
          this.cdr.markForCheck();
        },
      });

    this.loadingTrucks = true;
    this.loadsService
      .getEquipment('truck')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.trucks = (res?.data || []) as TruckOption[];
          this.loadingTrucks = false;
          this.syncTruckSearchFromValue();
          this.cdr.markForCheck();
        },
        error: () => {
          this.trucks = [];
          this.loadingTrucks = false;
          this.cdr.markForCheck();
        },
      });

    this.loadingTrailers = true;
    this.loadsService
      .getEquipment('trailer')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.trailers = res?.data || [];
          this.loadingTrailers = false;
          this.syncTrailerSearchFromValue();
          this.cdr.markForCheck();
        },
        error: () => {
          this.trailers = [];
          this.loadingTrailers = false;
          this.cdr.markForCheck();
        },
      });
  }

  // ─── Value <-> search-text sync (for prefilled edit/view forms) ─────────

  private syncDriverSearchFromValue(): void {
    const id = this.driverEquipment.get('driverId')?.value;
    if (!id) return;
    const found = this.drivers.find((d) => d.id === id);
    if (found) this.driverSearch = this.driverLabel(found);
  }

  private syncTruckSearchFromValue(): void {
    const id = this.driverEquipment.get('truckId')?.value;
    if (!id) return;
    const found = this.trucks.find((t) => t.id === id);
    if (found) this.truckSearch = this.equipLabel(found);
  }

  private syncTrailerSearchFromValue(): void {
    const id = this.driverEquipment.get('trailerId')?.value;
    if (!id) return;
    const found = this.trailers.find((t) => t.id === id);
    if (found) this.trailerSearch = this.equipLabel(found);
  }

  // ─── Labels ─────────────────────────────────────────────────────────────

  driverLabel(d: DriverOption): string {
    return `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Driver';
  }

  equipLabel(e: EquipmentOption): string {
    const parts: string[] = [e.unit_number || ''];
    const desc = `${e.make || ''} ${e.model || ''}`.trim();
    if (desc) parts.push(desc);
    return parts.filter(Boolean).join(' · ') || 'Equipment';
  }

  // ─── Selected-object accessors ──────────────────────────────────────────

  get driverId(): string | null {
    return this.driverEquipment.get('driverId')?.value ?? null;
  }

  get truckId(): string | null {
    return this.driverEquipment.get('truckId')?.value ?? null;
  }

  get trailerId(): string | null {
    return this.driverEquipment.get('trailerId')?.value ?? null;
  }

  get showAllTrucks(): boolean {
    return !!this.driverEquipment.get('showAllTrucks')?.value;
  }

  get selectedDriver(): DriverOption | null {
    return this.driverId ? this.drivers.find((d) => d.id === this.driverId) ?? null : null;
  }

  get selectedTruck(): TruckOption | null {
    return this.truckId ? this.trucks.find((t) => t.id === this.truckId) ?? null : null;
  }

  // ─── Driver combo ───────────────────────────────────────────────────────

  get filteredDrivers(): DriverOption[] {
    const q = this.driverSearch.trim().toLowerCase();
    if (!q) return this.drivers.slice(0, 50);
    return this.drivers
      .filter((d) => this.driverLabel(d).toLowerCase().includes(q))
      .slice(0, 50);
  }

  onDriverInput(value: string): void {
    this.driverSearch = value;
    if (!value.trim() && this.driverId) {
      // Clearing the search deselects the driver.
      this.clearDriver();
    }
    this.driverDropdownOpen = true;
    this.cdr.markForCheck();
  }

  selectDriver(driver: DriverOption): void {
    this.driverEquipment.patchValue(
      { driverId: driver.id, showAllTrucks: false },
      { emitEvent: false },
    );
    this.driverSearch = this.driverLabel(driver);
    this.driverDropdownOpen = false;

    // Auto-fill truck from driver's assignment (user can override later).
    if (driver.truckId) {
      const truck = this.trucks.find((t) => t.id === driver.truckId);
      if (truck) {
        this.driverEquipment.get('truckId')?.setValue(truck.id, { emitEvent: false });
        this.truckSearch = this.equipLabel(truck);
      }
    }

    // Auto-fill trailer from driver's assignment (optional).
    if (driver.trailerId) {
      const trailer = this.trailers.find((t) => t.id === driver.trailerId);
      if (trailer) {
        this.driverEquipment.get('trailerId')?.setValue(trailer.id, { emitEvent: false });
        this.trailerSearch = this.equipLabel(trailer);
      }
    }

    this.driverEquipment.updateValueAndValidity();
    this.cdr.markForCheck();
  }

  clearDriver(): void {
    this.driverEquipment.get('driverId')?.setValue(null);
    this.driverSearch = '';
    this.cdr.markForCheck();
  }

  // ─── Truck combo ────────────────────────────────────────────────────────

  get filteredTrucks(): TruckOption[] {
    const assignedDriverTruckId = this.selectedDriver?.truckId || null;
    let pool: TruckOption[];

    if (assignedDriverTruckId && !this.showAllTrucks) {
      const assigned = this.trucks.filter((t) => t.id === assignedDriverTruckId);
      pool = assigned.length ? assigned : this.trucks;
    } else {
      pool = this.trucks;
    }

    const q = this.truckSearch.trim().toLowerCase();
    if (!q) return pool.slice(0, 50);
    return pool
      .filter((t) => this.equipLabel(t).toLowerCase().includes(q))
      .slice(0, 50);
  }

  /** True when the driver has an assigned truck and we're currently filtering to it. */
  get hasDriverAssignedTruck(): boolean {
    return !!this.selectedDriver?.truckId && !this.showAllTrucks;
  }

  onTruckInput(value: string): void {
    this.truckSearch = value;
    if (!value.trim() && this.truckId) {
      this.clearTruck();
    }
    this.truckDropdownOpen = true;
    this.cdr.markForCheck();
  }

  selectTruck(truck: TruckOption): void {
    this.driverEquipment.get('truckId')?.setValue(truck.id);
    this.truckSearch = this.equipLabel(truck);
    this.truckDropdownOpen = false;
    this.cdr.markForCheck();
  }

  clearTruck(): void {
    this.driverEquipment.get('truckId')?.setValue(null);
    this.truckSearch = '';
    this.cdr.markForCheck();
  }

  toggleShowAllTrucks(showAll: boolean): void {
    this.driverEquipment.get('showAllTrucks')?.setValue(showAll);
    this.truckDropdownOpen = true;
    this.cdr.markForCheck();
  }

  // ─── Trailer combo ──────────────────────────────────────────────────────

  get filteredTrailers(): EquipmentOption[] {
    const q = this.trailerSearch.trim().toLowerCase();
    if (!q) return this.trailers.slice(0, 50);
    return this.trailers
      .filter((t) => this.equipLabel(t).toLowerCase().includes(q))
      .slice(0, 50);
  }

  onTrailerInput(value: string): void {
    this.trailerSearch = value;
    if (!value.trim() && this.trailerId) {
      this.clearTrailer();
    }
    this.trailerDropdownOpen = true;
    this.cdr.markForCheck();
  }

  selectTrailer(trailer: EquipmentOption): void {
    this.driverEquipment.get('trailerId')?.setValue(trailer.id);
    this.trailerSearch = this.equipLabel(trailer);
    this.trailerDropdownOpen = false;
    this.cdr.markForCheck();
  }

  clearTrailer(): void {
    this.driverEquipment.get('trailerId')?.setValue(null);
    this.trailerSearch = '';
    this.cdr.markForCheck();
  }

  // ─── Dropdown open/close helpers ────────────────────────────────────────

  openDriverDropdown(): void {
    if (this.isView()) return;
    this.driverDropdownOpen = true;
    this.cdr.markForCheck();
  }

  openTruckDropdown(): void {
    if (this.isView()) return;
    this.truckDropdownOpen = true;
    this.cdr.markForCheck();
  }

  openTrailerDropdown(): void {
    if (this.isView()) return;
    this.trailerDropdownOpen = true;
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.elRef.nativeElement.contains(event.target)) return;
    if (!this.driverDropdownOpen && !this.truckDropdownOpen && !this.trailerDropdownOpen) {
      return;
    }
    this.driverDropdownOpen = false;
    this.truckDropdownOpen = false;
    this.trailerDropdownOpen = false;
    this.cdr.markForCheck();
  }
}
