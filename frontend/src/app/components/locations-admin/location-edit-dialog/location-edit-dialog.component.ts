import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges
} from '@angular/core';
import {
  Location,
  LocationFormValue,
  LocationType,
  OperatingHours,
  OperatingHoursDay
} from '../../../models/location.model';
import { ApiService } from '../../../services/api.service';

export type DialogTab = 'details' | 'bins' | 'users' | 'supply_rules';

const WEEKDAY_DEFAULT: OperatingHoursDay = { closed: false, open: '08:00', close: '17:00' };
const WEEKEND_DEFAULT: OperatingHoursDay = { closed: true, open: '08:00', close: '17:00' };

const US_TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern (ET)' },
  { value: 'America/Chicago',     label: 'Central (CT)' },
  { value: 'America/Denver',      label: 'Mountain (MT)' },
  { value: 'America/Phoenix',     label: 'Mountain — no DST (AZ)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage',   label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii (HT)' },
  { value: 'America/Puerto_Rico', label: 'Atlantic (AST)' },
  { value: 'UTC',                 label: 'UTC' },
];

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string; description: string }[] = [
  { value: 'SHOP',      label: 'Shop',       description: 'Repair / service facility' },
  { value: 'YARD',      label: 'Yard',        description: 'Truck / trailer parking yard' },
  { value: 'DROP_YARD', label: 'Drop Yard',   description: 'Driver drop-off / pickup yard' },
  { value: 'WAREHOUSE', label: 'Warehouse',   description: 'Parts / inventory storage' },
  { value: 'OFFICE',    label: 'Office',      description: 'Administrative office' },
  { value: 'TERMINAL',  label: 'Terminal',    description: 'Freight terminal' },
];

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC','PR','GU','VI'
];

@Component({
  selector: 'app-location-edit-dialog',
  templateUrl: './location-edit-dialog.component.html',
  styleUrls: ['./location-edit-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LocationEditDialogComponent implements OnChanges {
  /** Pass null to open in Add mode; pass a Location to open in Edit mode. */
  @Input() location: Location | null = null;
  @Input() isOpen = false;
  /** Which tab to activate when the dialog opens. Defaults to 'details'. */
  @Input() initialTab: DialogTab = 'details';

  /** Emitted after a successful save so the parent can refresh the list. */
  @Output() saved = new EventEmitter<void>();
  /** Emitted when the user clicks Cancel or the backdrop. */
  @Output() close = new EventEmitter<void>();

  // ── Tab navigation ────────────────────────────────────────────────────────
  activeTab: DialogTab = 'details';

  // ── Form state ────────────────────────────────────────────────────────────
  name = '';
  code = '';
  locationType: LocationType | '' = '';
  addressLine1 = '';
  addressLine2 = '';
  city = '';
  state = '';
  zip = '';
  phone = '';
  email = '';
  contactName = '';
  timezone = 'America/New_York';
  active = true;
  operatingHours: OperatingHours = this.buildDefaultHours();

  saving = false;
  errors: Record<string, string> = {};

  // ── Static option lists (initialised once; safe for OnPush) ──────────────
  readonly timezones = US_TIMEZONES;
  readonly locationTypeOptions = LOCATION_TYPE_OPTIONS;
  readonly stateOptions = US_STATES.map(s => ({ value: s, label: s }));
  readonly days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;
  readonly dayLabels: Record<string, string> = {
    monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
    thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun'
  };

  // ── Derived flags ─────────────────────────────────────────────────────────
  get isEditMode(): boolean { return !!this.location; }
  get dialogTitle(): string { return this.isEditMode ? 'Edit Location' : 'Add Location'; }
  get showBinsTab(): boolean {
    return this.locationType === 'SHOP' || this.locationType === 'WAREHOUSE';
  }
  get showSupplyRulesTab(): boolean {
    return this.locationType === 'SHOP' || this.locationType === 'WAREHOUSE';
  }

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetForm();
    }
  }

  // ── Form helpers ──────────────────────────────────────────────────────────

  resetForm(): void {
    this.activeTab = this.initialTab || 'details';
    this.errors = {};
    this.saving = false;

    if (this.location) {
      this.name        = this.location.name ?? '';
      this.code        = this.location.code ?? '';
      this.locationType = (this.location.location_type as LocationType) ?? '';
      this.addressLine1 = this.location.address ?? '';
      this.addressLine2 = '';
      this.city        = this.location.city ?? '';
      this.state       = this.location.state ?? '';
      this.zip         = this.location.zip ?? '';
      this.phone       = this.location.phone ?? '';
      this.email       = this.location.email ?? '';
      this.contactName = this.location.contact_name ?? '';
      this.timezone    = this.location.timezone ?? 'America/New_York';
      this.active      = this.location.active !== false;
      this.operatingHours = this.mergeHours(this.location.operating_hours);
    } else {
      this.name = this.code = this.locationType = this.addressLine1 =
      this.addressLine2 = this.city = this.state = this.zip =
      this.phone = this.email = this.contactName = '';
      this.timezone = 'America/New_York';
      this.active = true;
      this.operatingHours = this.buildDefaultHours();
    }
  }

  buildDefaultHours(): OperatingHours {
    return {
      monday:    { ...WEEKDAY_DEFAULT },
      tuesday:   { ...WEEKDAY_DEFAULT },
      wednesday: { ...WEEKDAY_DEFAULT },
      thursday:  { ...WEEKDAY_DEFAULT },
      friday:    { ...WEEKDAY_DEFAULT },
      saturday:  { ...WEEKEND_DEFAULT },
      sunday:    { ...WEEKEND_DEFAULT },
    };
  }

  mergeHours(incoming: OperatingHours | null | undefined): OperatingHours {
    const defaults = this.buildDefaultHours();
    if (!incoming) return defaults;
    for (const day of this.days) {
      if (incoming[day]) {
        defaults[day] = { ...defaults[day], ...incoming[day] };
      }
    }
    return defaults;
  }

  setTab(tab: DialogTab): void {
    this.activeTab = tab;
  }

  // ── Validation ────────────────────────────────────────────────────────────

  validateForm(): boolean {
    this.errors = {};
    if (!this.name.trim())    this.errors['name']         = 'Name is required';
    if (!this.locationType)   this.errors['locationType'] = 'Type is required';
    if (this.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.errors['email'] = 'Enter a valid email address';
    }
    return Object.keys(this.errors).length === 0;
  }

  // ── Payload builder ───────────────────────────────────────────────────────

  private buildPayload(): LocationFormValue {
    const hours: Record<string, OperatingHoursDay> = {};
    for (const day of this.days) {
      hours[day] = { ...this.operatingHours[day] };
    }
    return {
      name:           this.name.trim(),
      code:           this.code.trim() || undefined,
      location_type:  this.locationType as LocationType,
      address:        this.addressLine1.trim() || undefined,
      city:           this.city.trim() || undefined,
      state:          this.state.trim() || undefined,
      zip:            this.zip.trim() || undefined,
      phone:          this.phone.trim() || undefined,
      email:          this.email.trim() || undefined,
      contact_name:   this.contactName.trim() || undefined,
      timezone:       this.timezone,
      active:         this.active,
      operating_hours: hours,
    };
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async onSave(): Promise<void> {
    if (!this.validateForm()) return;
    this.saving = true;
    this.cdr.markForCheck();

    const payload = this.buildPayload();

    try {
      if (this.isEditMode && this.location?.id) {
        await this.api.updateLocation(this.location.id, payload).toPromise();
      } else {
        await this.api.createLocation(payload).toPromise();
      }
      this.saved.emit();
      this.onClose();
    } catch (err: any) {
      const msg: string = err?.error?.message || 'Failed to save location';
      if (msg.toLowerCase().includes('name')) {
        this.errors['name'] = msg;
      } else {
        this.errors['general'] = msg;
      }
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('led-backdrop')) {
      this.onClose();
    }
  }
}
