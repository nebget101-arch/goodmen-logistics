import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  HostListener,
  ElementRef,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { LoadsService, DriverOption, EquipmentOption } from '../../../../services/loads.service';

/** DriverOption extended with optional position fields that some API responses include. */
interface DriverRow {
  id: string;
  name: string;
  truckId: string | null;
  trailerId: string | null;
  position_city?: string | null;
  position_state?: string | null;
}

/** EquipmentOption extended with owner fields from the vehicles table. */
interface TruckOption extends EquipmentOption {
  equipment_owner?: string | null;
  equipment_owner_id?: string | null;
}

const RECENT_DRIVER_KEY = 'fn_recent_driver_ids';
const MAX_RECENT = 5;

/**
 * WizardStepDriverComponent — Step 3 of the Load Creation Wizard (FN-735).
 *
 * Features:
 * - Driver autocomplete with "Last Used" section showing up to 5 recently selected drivers
 * - Selecting a driver auto-fills their assigned truck and trailer
 * - Truck autocomplete filtered to driver's assigned truck by default; "Show all" toggle
 * - Equipment owner badge rendered next to truck unit number
 * - Driver's current position displayed when available
 * - Trailer autocomplete (unfiltered)
 * - Step is valid (emits validChange=true) when a driver is selected
 */
@Component({
  selector: 'app-wizard-step-driver',
  templateUrl: './step-driver.component.html',
  styleUrls: ['./step-driver.component.scss'],
})
export class WizardStepDriverComponent implements OnInit, OnDestroy {

  // ─── Inputs: current selections ────────────────────────────────────────────

  @Input() driverId: string | null = null;
  @Input() truckId: string | null = null;
  @Input() trailerId: string | null = null;

  // ─── Outputs ───────────────────────────────────────────────────────────────

  @Output() driverIdChange  = new EventEmitter<string | null>();
  @Output() truckIdChange   = new EventEmitter<string | null>();
  @Output() trailerIdChange = new EventEmitter<string | null>();
  /** Emits true when at least a driver is selected — parent uses for stepValid[2]. */
  @Output() validChange = new EventEmitter<boolean>();

  // ─── Data ──────────────────────────────────────────────────────────────────

  allDrivers:  DriverRow[]    = [];
  allTrucks:   TruckOption[]  = [];
  allTrailers: EquipmentOption[] = [];

  loadingDrivers  = false;
  loadingTrucks   = false;
  loadingTrailers = false;

  // ─── Search / dropdown state ───────────────────────────────────────────────

  driverSearch  = '';
  truckSearch   = '';
  trailerSearch = '';

  driverDropdownOpen  = false;
  truckDropdownOpen   = false;
  trailerDropdownOpen = false;

  /** When true, truck list shows all trucks regardless of driver assignment. */
  showAllTrucks = false;

  // ─── Recently used drivers (localStorage) ─────────────────────────────────

  recentDriverIds: string[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private loadsService: LoadsService,
    private elRef: ElementRef,
  ) {}

  ngOnInit(): void {
    this._loadRecentIds();
    this._loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Data loading ──────────────────────────────────────────────────────────

  private _loadData(): void {
    this.loadingDrivers = true;
    this.loadsService.getActiveDrivers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.allDrivers = (data || []).map((d: any) => ({
            id: d.id,
            name: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
            truckId:  d.truckId  || null,
            trailerId: d.trailerId || null,
            position_city:  d.position_city  || null,
            position_state: d.position_state || null,
          }));
          this.loadingDrivers = false;
          // Restore display name if driverId was pre-populated
          if (this.driverId) {
            const found = this.allDrivers.find(d => d.id === this.driverId);
            if (found) { this.driverSearch = found.name; }
          }
        },
        error: () => { this.loadingDrivers = false; },
      });

    this.loadingTrucks = true;
    this.loadsService.getEquipment('truck')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.allTrucks = (res?.data || []) as TruckOption[];
          this.loadingTrucks = false;
          if (this.truckId) {
            const found = this.allTrucks.find(t => t.id === this.truckId);
            if (found) { this.truckSearch = this._truckLabel(found); }
          }
        },
        error: () => { this.loadingTrucks = false; },
      });

    this.loadingTrailers = true;
    this.loadsService.getEquipment('trailer')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.allTrailers = res?.data || [];
          this.loadingTrailers = false;
          if (this.trailerId) {
            const found = this.allTrailers.find(t => t.id === this.trailerId);
            if (found) { this.trailerSearch = this._equipLabel(found); }
          }
        },
        error: () => { this.loadingTrailers = false; },
      });
  }

  // ─── Recent drivers (localStorage) ────────────────────────────────────────

  private _loadRecentIds(): void {
    try {
      const raw = localStorage.getItem(RECENT_DRIVER_KEY);
      this.recentDriverIds = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      this.recentDriverIds = [];
    }
  }

  private _saveRecentId(id: string): void {
    const updated = [id, ...this.recentDriverIds.filter(x => x !== id)].slice(0, MAX_RECENT);
    this.recentDriverIds = updated;
    try { localStorage.setItem(RECENT_DRIVER_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  }

  /** Top-5 recently used drivers that are still in the active drivers list. */
  get recentDrivers(): DriverRow[] {
    return this.recentDriverIds
      .map(id => this.allDrivers.find(d => d.id === id))
      .filter(Boolean) as DriverRow[];
  }

  // ─── Driver autocomplete ───────────────────────────────────────────────────

  get filteredDrivers(): DriverRow[] {
    const q = this.driverSearch.trim().toLowerCase();
    if (!q) { return this.allDrivers.slice(0, 50); }
    return this.allDrivers.filter(d => d.name.toLowerCase().includes(q)).slice(0, 50);
  }

  selectDriver(driver: DriverRow): void {
    this.driverId    = driver.id;
    this.driverSearch = driver.name;
    this.driverDropdownOpen = false;
    this._saveRecentId(driver.id);
    this.driverIdChange.emit(driver.id);

    // Auto-fill truck from driver's assignment
    this.showAllTrucks = false;
    if (driver.truckId) {
      const truck = this.allTrucks.find(t => t.id === driver.truckId);
      if (truck) {
        this.truckId     = truck.id;
        this.truckSearch = this._truckLabel(truck);
        this.truckIdChange.emit(truck.id);
      }
    }
    // Auto-fill trailer from driver's assignment
    if (driver.trailerId) {
      const trailer = this.allTrailers.find(t => t.id === driver.trailerId);
      if (trailer) {
        this.trailerId     = trailer.id;
        this.trailerSearch = this._equipLabel(trailer);
        this.trailerIdChange.emit(trailer.id);
      }
    }

    this._emitValid();
  }

  clearDriver(): void {
    this.driverId     = null;
    this.driverSearch = '';
    this.driverIdChange.emit(null);
    this._emitValid();
  }

  onDriverInputChange(): void {
    if (!this.driverSearch.trim()) {
      // Treat clearing input as deselect
      if (this.driverId) { this.clearDriver(); }
    }
    this.driverDropdownOpen = true;
  }

  // ─── Truck autocomplete ────────────────────────────────────────────────────

  /** Trucks shown in dropdown: driver-filtered by default, all when showAllTrucks=true. */
  get filteredTrucks(): TruckOption[] {
    const assignedDriver = this.driverId ? this.allDrivers.find(d => d.id === this.driverId) : null;
    let pool: TruckOption[];

    if (assignedDriver?.truckId && !this.showAllTrucks) {
      const assigned = this.allTrucks.filter(t => t.id === assignedDriver.truckId);
      pool = assigned.length ? assigned : this.allTrucks;
    } else {
      pool = this.allTrucks;
    }

    const q = this.truckSearch.trim().toLowerCase();
    if (!q) { return pool.slice(0, 50); }
    return pool.filter(t => this._truckLabel(t).toLowerCase().includes(q)).slice(0, 50);
  }

  /** True when there is a driver-assigned truck that isn't being shown (i.e. "show all" is relevant). */
  get hasDriverAssignedTruck(): boolean {
    const driver = this.driverId ? this.allDrivers.find(d => d.id === this.driverId) : null;
    return !!(driver?.truckId) && !this.showAllTrucks;
  }

  selectTruck(truck: TruckOption): void {
    this.truckId     = truck.id;
    this.truckSearch = this._truckLabel(truck);
    this.truckDropdownOpen = false;
    this.truckIdChange.emit(truck.id);
  }

  clearTruck(): void {
    this.truckId     = null;
    this.truckSearch = '';
    this.truckIdChange.emit(null);
  }

  // ─── Trailer autocomplete ──────────────────────────────────────────────────

  get filteredTrailers(): EquipmentOption[] {
    const q = this.trailerSearch.trim().toLowerCase();
    if (!q) { return this.allTrailers.slice(0, 50); }
    return this.allTrailers.filter(t => this._equipLabel(t).toLowerCase().includes(q)).slice(0, 50);
  }

  selectTrailer(trailer: EquipmentOption): void {
    this.trailerId     = trailer.id;
    this.trailerSearch = this._equipLabel(trailer);
    this.trailerDropdownOpen = false;
    this.trailerIdChange.emit(trailer.id);
  }

  clearTrailer(): void {
    this.trailerId     = null;
    this.trailerSearch = '';
    this.trailerIdChange.emit(null);
  }

  // ─── Selected objects ─────────────────────────────────────────────────────

  get selectedDriver(): DriverRow | null {
    return this.driverId ? (this.allDrivers.find(d => d.id === this.driverId) ?? null) : null;
  }

  get selectedTruck(): TruckOption | null {
    return this.truckId ? (this.allTrucks.find(t => t.id === this.truckId) ?? null) : null;
  }

  // ─── Driver position ──────────────────────────────────────────────────────

  /** Returns "City, ST" when driver has a known current position, else null. */
  get driverPositionDisplay(): string | null {
    const d = this.selectedDriver;
    if (!d) { return null; }
    const city  = (d.position_city  || '').trim();
    const state = (d.position_state || '').trim();
    if (city && state) { return `${city}, ${state}`; }
    return city || state || null;
  }

  // ─── Labels ───────────────────────────────────────────────────────────────

  _truckLabel(t: TruckOption): string {
    const parts = [t.unit_number];
    if (t.make || t.model) { parts.push(`${t.make || ''} ${t.model || ''}`.trim()); }
    return parts.join(' · ');
  }

  _equipLabel(t: EquipmentOption): string {
    const parts = [t.unit_number];
    if (t.make || t.model) { parts.push(`${t.make || ''} ${t.model || ''}`.trim()); }
    return parts.join(' · ');
  }

  // ─── Click-outside to close dropdowns ─────────────────────────────────────

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.driverDropdownOpen  = false;
      this.truckDropdownOpen   = false;
      this.trailerDropdownOpen = false;
    }
  }

  // ─── Validity ─────────────────────────────────────────────────────────────

  private _emitValid(): void {
    this.validChange.emit(!!this.driverId);
  }

  get isValid(): boolean { return !!this.driverId; }
}
