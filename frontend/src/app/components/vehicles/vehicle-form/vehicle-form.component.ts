import { Component, EventEmitter, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, Output } from '@angular/core';
import { ApiService } from '../../../services/api.service';

export type OwnershipType = 'company' | 'oo' | 'leased';

interface VehicleFormData {
  id?: string;
  unit_number: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  license_plate: string;
  state: string;
  status: string;
  mileage: number;
  inspection_expiry: string;
  next_pm_due: string;
  next_pm_mileage: number;
  insurance_expiry: string;
  registration_expiry: string;
  oos_reason?: string;
  vehicle_type?: 'truck' | 'trailer';
  trailer_details?: TrailerDetails;
  // FN-1387: ownership classification + conditional fields. `company_owned` is
  // derived server-side from `ownership_type` (FN-1386), so the form only
  // sends the enum and lets backend keep the legacy boolean in sync.
  ownership_type: OwnershipType;
  equipment_owner_name?: string;
  equipment_owner_id?: string;
  equipment_owner_percentage?: number | null;
  operating_entity_id?: string;
  lessor_name?: string;
  lease_date?: string;
  lease_payment_amount?: number | null;
}

interface TrailerDetails {
  trailer_type_code: string;
  trailer_type_label: string;
  assigned_driver_id: string;
  ownership: 'owned' | 'leased';
  purchase_date: string;
  purchase_price: number | null;
  lease_date: string;
  lessor_name: string;
  fid_number: string;
  address: string;
  address_line2: string;
  city: string;
  lease_state: string;
  zip: string;
  phone: string;
  notes: string;
  history: string;
}

interface Document {
  id?: string;
  type: string;
  name: string;
  file?: File;
  expiry_date?: string;
  status?: 'valid' | 'warning' | 'expired';
  uploaded_date?: string;
}

@Component({
  selector: 'app-vehicle-form',
  templateUrl: './vehicle-form.component.html',
  styleUrls: ['./vehicle-form.component.css']
})
export class VehicleFormComponent implements OnInit, OnChanges, OnDestroy {
  @Input() vehicle: any = null;
  @Input() isOpen = false;
  @Input() vehicleType: 'truck' | 'trailer' = 'truck';
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<any>();

  currentYear = new Date().getFullYear();
  maxYear = new Date().getFullYear() + 1;
  unitNumberManuallyEdited = false;

  formData: VehicleFormData = {
    unit_number: '',
    vin: '',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    license_plate: '',
    state: '',
    status: 'in-service',
    mileage: 0,
    inspection_expiry: '',
    next_pm_due: '',
    next_pm_mileage: 0,
    insurance_expiry: '',
    registration_expiry: '',
    oos_reason: '',
    vehicle_type: 'truck',
    ownership_type: 'company',
    equipment_owner_name: '',
    equipment_owner_id: '',
    equipment_owner_percentage: null,
    operating_entity_id: '',
    lessor_name: '',
    lease_date: '',
    lease_payment_amount: null
  };

  trailerForm: TrailerDetails = this.getDefaultTrailerDetails();
  drivers: any[] = [];
  trailerTypeSearch = '';
  trailerTypeDropdownOpen = false;
  vinDecoding = false;
  vinDecodeMessage = '';
  private vinDecodeTimer: ReturnType<typeof setTimeout> | null = null;

  // FN-1387: equipment-owner typeahead (sourced from settlements payee search,
  // which already returns equipment-owner payees) + operating entity dropdown.
  equipmentOwnerSearch = '';
  equipmentOwnerResults: Array<{ id: string; name: string }> = [];
  equipmentOwnerDropdownOpen = false;
  equipmentOwnerLoading = false;
  private equipmentOwnerSearchTimer: ReturnType<typeof setTimeout> | null = null;
  operatingEntities: any[] = [];
  operatingEntitySelectOptionsCached: { value: string; label: string }[] = [];

  // FN-1387: trailer details accordion (collapsed by default; auto-open on
  // edit when trailer-specific fields are non-empty so legacy data stays
  // discoverable).
  trailerDetailsExpanded = false;

  documents: Document[] = [];
  
  documentTypes = [
    { value: 'inspection', label: 'Annual Inspection' },
    { value: 'registration', label: 'Registration' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'maintenance', label: 'Repairs & Maintenance' },
    { value: 'other', label: 'Other Documents' }
  ];

  docIconMap: Record<string, string> = {
    inspection: 'verified_user',
    registration: 'assignment',
    insurance: 'security',
    maintenance: 'build',
    other: 'smart_toy'
  };

  states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  // Cached options — computed once and updated only when source data changes.
  // Using getters that return new arrays on every call causes infinite change detection loops
  // with OnPush child components like app-ai-select.
  stateSelectOptionsCached: { value: string; label: string }[] = [];
  driverSelectOptionsCached: { value: string; label: string }[] = [];
  makeSelectOptionsCached: { value: string; label: string }[] = [];

  get stateSelectOptions(): { value: string; label: string }[] {
    return this.stateSelectOptionsCached;
  }

  get driverSelectOptions(): { value: string; label: string }[] {
    return this.driverSelectOptionsCached;
  }

  get makeSelectOptions(): { value: string; label: string }[] {
    return this.makeSelectOptionsCached;
  }

  get operatingEntitySelectOptions(): { value: string; label: string }[] {
    return this.operatingEntitySelectOptionsCached;
  }

  statusSelectOptions = [
    { value: 'in-service', label: 'In Service' },
    { value: 'out-of-service', label: 'Out of Service' }
  ];

  makes = ['Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'Mack', 'International', 'Western Star'];

  readonly trailerTypeOptions = [
    { id: 'AC', value: 'Auto Carrier' },
    { id: 'BT', value: 'B-Train' },
    { id: 'CN', value: 'Conestoga' },
    { id: 'C', value: 'Container' },
    { id: 'CI', value: 'Container Insulated' },
    { id: 'CR', value: 'Container Refrigerated' },
    { id: 'CV', value: 'Conveyor' },
    { id: 'DD', value: 'Double Drop' },
    { id: 'LA', value: 'Drop Deck Landoll' },
    { id: 'DT', value: 'Dump Trailer' },
    { id: 'F', value: 'Flatbed' },
    { id: 'FA', value: 'Flatbed Air-Ride' },
    { id: 'FN', value: 'Flatbed Conestoga' },
    { id: 'F2', value: 'Flatbed Double' },
    { id: 'FZ', value: 'Flatbed HazMat' },
    { id: 'FH', value: 'Flatbed Hotshot' },
    { id: 'MX', value: 'Flatbed Maxi' },
    { id: 'FD', value: 'Flatbed or Step Deck' },
    { id: 'FO', value: 'Flatbed Overdimension' },
    { id: 'FC', value: 'Flatbed w/Chains' },
    { id: 'FS', value: 'Flatbed w/Sides' },
    { id: 'FT', value: 'Flatbed w/Tarps' },
    { id: 'FM', value: 'Flatbed w/Team' },
    { id: 'FR', value: 'Flatbed/Van/Reefer' },
    { id: 'HB', value: 'Hopper Bottom' },
    { id: 'IR', value: 'Insulated Van or Reefer' },
    { id: 'LB', value: 'Lowboy' },
    { id: 'LR', value: 'Lowboy or Rem Gooseneck (RGN)' },
    { id: 'LO', value: 'Lowboy Overdimension' },
    { id: 'MV', value: 'Moving Van' },
    { id: 'NU', value: 'Pneumatic' },
    { id: 'PO', value: 'Power Only' },
    { id: 'R', value: 'Reefer' },
    { id: 'RA', value: 'Reefer Air-Ride' },
    { id: 'R2', value: 'Reefer Double' },
    { id: 'RZ', value: 'Reefer HazMat' },
    { id: 'RN', value: 'Reefer Intermodal' },
    { id: 'RL', value: 'Reefer Logistics' },
    { id: 'RV', value: 'Reefer or Vented Van' },
    { id: 'RP', value: 'Reefer Pallet Exchange' },
    { id: 'RM', value: 'Reefer w/Team' },
    { id: 'RG', value: 'Removable Gooseneck' },
    { id: 'SD', value: 'Step Deck' },
    { id: 'SR', value: 'Step Deck or Rem Gooseneck (RGN)' },
    { id: 'SN', value: 'Stepdeck Conestoga' },
    { id: 'SB', value: 'Straight Box Truck' },
    { id: 'ST', value: 'Stretch Trailer' },
    { id: 'TA', value: 'Tanker Aluminum' },
    { id: 'TN', value: 'Tanker Intermodal' },
    { id: 'TS', value: 'Tanker Steel' },
    { id: 'TT', value: 'Truck and Trailer' },
    { id: 'V', value: 'Van' },
    { id: 'VA', value: 'Van Air-Ride' },
    { id: 'VW', value: 'Van Blanket Wrap' },
    { id: 'VS', value: 'Van Conestoga' },
    { id: 'V2', value: 'Van Double' },
    { id: 'VZ', value: 'Van HazMat' },
    { id: 'VH', value: 'Van Hotshot' },
    { id: 'VI', value: 'Van Insulated' },
    { id: 'VN', value: 'Van Intermodal' },
    { id: 'VG', value: 'Van Lift-Gate' },
    { id: 'VL', value: 'Van Logistics' },
    { id: 'OT', value: 'Van Open-Top' },
    { id: 'VF', value: 'Van or Flatbed' },
    { id: 'VT', value: 'Van or Flatbed w/Tarps' },
    { id: 'VR', value: 'Van or Reefer' },
    { id: 'VP', value: 'Van Pallet Exchange' },
    { id: 'VB', value: 'Van Roller Bed' },
    { id: 'V3', value: 'Van Triple' },
    { id: 'VV', value: 'Van Vented' },
    { id: 'VC', value: 'Van w/Curtains' },
    { id: 'VM', value: 'Van w/Team' }
  ];
  
  isEditMode = false;
  saving = false;
  errors: any = {};
  submitted = false;

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    console.log('[VEHICLE-FORM] ngOnInit, isOpen:', this.isOpen, 'vehicleType:', this.vehicleType);
    try {
      // Initialize cached select options (must be done here, not in field initializers,
      // because 'makes' and 'states' may not be initialized yet at field declaration time)
      this.stateSelectOptionsCached = this.states.map(s => ({ value: s, label: s }));
      this.makeSelectOptionsCached = this.makes.map(m => ({ value: m, label: m }));
      this.updateFilteredTrailerTypeOptions();
      this.loadDrivers();
      this.loadOperatingEntities();
      this.loadFormData();
    } catch (err) {
      console.error('[VEHICLE-FORM] ERROR in ngOnInit:', err);
    }
  }

  ngOnDestroy(): void {
    if (this.vinDecodeTimer) {
      clearTimeout(this.vinDecodeTimer);
      this.vinDecodeTimer = null;
    }
    if (this.equipmentOwnerSearchTimer) {
      clearTimeout(this.equipmentOwnerSearchTimer);
      this.equipmentOwnerSearchTimer = null;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    console.log('[VEHICLE-FORM] ngOnChanges fired, isOpen:', this.isOpen, 'changes:', Object.keys(changes));
    if (changes['vehicle'] || changes['isOpen']) {
      try {
        console.log('[VEHICLE-FORM] Loading form data, isOpen:', this.isOpen, 'vehicle:', this.vehicle?.id || 'new');
        this.loadFormData();
        this.submitted = false;
        this.errors = {};
        console.log('[VEHICLE-FORM] Form data loaded successfully, formData.vehicle_type:', this.formData.vehicle_type);
      } catch (err) {
        console.error('[VEHICLE-FORM] ERROR in loadFormData:', err);
      }
    }
  }

  loadFormData(): void {
    if (this.vehicle) {
      this.isEditMode = true;
      this.unitNumberManuallyEdited = true; // Don't auto-overwrite existing unit numbers
      this.formData = { ...this.vehicle };
      // Sanitize null string fields to prevent template crashes
      this.formData.unit_number = this.formData.unit_number || '';
      this.formData.vin = this.formData.vin || '';
      this.formData.make = this.formData.make || '';
      this.formData.model = this.formData.model || '';
      this.formData.license_plate = this.formData.license_plate || '';
      this.formData.state = this.formData.state || '';
      this.formData.inspection_expiry = this.formData.inspection_expiry || '';
      this.formData.next_pm_due = this.formData.next_pm_due || '';
      this.formData.insurance_expiry = this.formData.insurance_expiry || '';
      this.formData.registration_expiry = this.formData.registration_expiry || '';
      this.formData.oos_reason = this.formData.oos_reason || '';
      this.formData.equipment_owner_name = this.formData.equipment_owner_name || '';
      this.formData.equipment_owner_id = this.formData.equipment_owner_id || '';
      this.formData.equipment_owner_percentage = this.formData.equipment_owner_percentage ?? null;
      this.formData.operating_entity_id = this.formData.operating_entity_id || '';
      this.formData.lessor_name = this.formData.lessor_name || '';
      this.formData.lease_date = this.formData.lease_date || '';
      this.formData.lease_payment_amount = this.formData.lease_payment_amount ?? null;
      if (!this.formData.vehicle_type) {
        this.formData.vehicle_type = this.vehicleType;
      }
      this.formData.status = this.formData.status || 'in-service';

      const trailerDetailsRaw = this.vehicle?.trailer_details;
      const parsedTrailerDetails = this.parseTrailerDetails(trailerDetailsRaw);
      this.trailerForm = {
        ...this.getDefaultTrailerDetails(),
        ...parsedTrailerDetails
      };
      this.syncTrailerTypeSearchFromCurrent();

      // FN-1387: derive ownership_type from server payload, falling back to
      // legacy signals (`company_owned` + `trailer_details.ownership`) so that
      // pre-FN-1385 rows still render as the right segmented option.
      this.formData.ownership_type = this.deriveOwnershipType(this.vehicle, this.trailerForm);

      // For trailers stored as leased before FN-1387, lessor + lease date
      // lived inside trailer_details. Mirror them onto the top-level fields
      // so the shared Ownership section can display them.
      if (this.formData.ownership_type === 'leased' && this.isTrailerMode) {
        this.formData.lessor_name = this.formData.lessor_name || this.trailerForm.lessor_name || '';
        this.formData.lease_date = this.formData.lease_date || this.trailerForm.lease_date || '';
      }

      // Seed the typeahead search input with the saved owner name so users
      // see what was previously selected.
      this.equipmentOwnerSearch = this.formData.equipment_owner_name || '';
      this.equipmentOwnerResults = [];
      this.equipmentOwnerDropdownOpen = false;

      // Auto-expand trailer details when there's existing data worth showing.
      this.trailerDetailsExpanded = this.isTrailerMode && this.hasTrailerDetailContent(this.trailerForm);
    } else {
      this.isEditMode = false;
      this.unitNumberManuallyEdited = false;
      this.formData = {
        unit_number: '',
        vin: '',
        make: '',
        model: '',
        year: new Date().getFullYear(),
        license_plate: '',
        state: '',
        status: 'in-service',
        mileage: 0,
        inspection_expiry: '',
        next_pm_due: '',
        next_pm_mileage: 0,
        insurance_expiry: '',
        registration_expiry: '',
        oos_reason: '',
        vehicle_type: this.vehicleType,
        ownership_type: 'company',
        equipment_owner_name: '',
        equipment_owner_id: '',
        equipment_owner_percentage: null,
        operating_entity_id: '',
        lessor_name: '',
        lease_date: '',
        lease_payment_amount: null
      };
      this.trailerForm = this.getDefaultTrailerDetails();
      this.trailerTypeSearch = '';
      this.equipmentOwnerSearch = '';
      this.equipmentOwnerResults = [];
      this.equipmentOwnerDropdownOpen = false;
      this.trailerDetailsExpanded = false;
    }
  }

  private deriveOwnershipType(vehicle: any, trailer: TrailerDetails): OwnershipType {
    const raw = vehicle?.ownership_type;
    if (raw === 'company' || raw === 'oo' || raw === 'leased') {
      return raw;
    }
    if (vehicle?.vehicle_type === 'trailer' && trailer?.ownership === 'leased') {
      return 'leased';
    }
    if (vehicle?.company_owned === false) {
      return 'oo';
    }
    return 'company';
  }

  private hasTrailerDetailContent(trailer: TrailerDetails): boolean {
    return Boolean(
      trailer?.trailer_type_code ||
        trailer?.assigned_driver_id ||
        trailer?.fid_number ||
        trailer?.address ||
        trailer?.city ||
        trailer?.notes ||
        trailer?.history
    );
  }

  onVinChange(): void {
    const vin = (this.formData.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.formData.vin = vin;

    if (vin && vin.length >= 4 && !this.unitNumberManuallyEdited) {
      const suffix = vin.slice(-4);
      this.formData.unit_number = this.isTrailerMode ? `TR-${suffix}` : suffix;
    }

    if (this.vinDecodeTimer) {
      clearTimeout(this.vinDecodeTimer);
      this.vinDecodeTimer = null;
    }

    if (vin.length !== 17) {
      this.vinDecodeMessage = '';
      this.vinDecoding = false;
      return;
    }

    this.vinDecodeTimer = setTimeout(() => this.decodeVin(), 500);
  }

  get formTitle(): string {
    return (this.formData.vehicle_type || this.vehicleType) === 'trailer' ? 'Trailer' : 'Truck';
  }

  get isTrailerMode(): boolean {
    return (this.formData.vehicle_type || this.vehicleType) === 'trailer';
  }

  get isInactive(): boolean {
    return this.formData.status === 'out-of-service';
  }

  setInactive(value: boolean): void {
    this.formData.status = value ? 'out-of-service' : 'in-service';
  }

  loadDrivers(): void {
    this.apiService.getDispatchDrivers().subscribe({
      next: (data: any[]) => {
        this.drivers = Array.isArray(data) ? data : [];
        this.driverSelectOptionsCached = this.drivers.map(d => ({
          value: d.id,
          label: `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unknown'
        }));
      },
      error: () => {
        this.drivers = [];
        this.driverSelectOptionsCached = [];
      }
    });
  }

  loadOperatingEntities(): void {
    this.apiService.listOperatingEntities().subscribe({
      next: (data: any) => {
        const list = Array.isArray(data) ? data : (Array.isArray(data?.entities) ? data.entities : []);
        this.operatingEntities = list;
        this.operatingEntitySelectOptionsCached = list.map((e: any) => ({
          value: String(e.id),
          label: e.name || e.legal_name || e.dba_name || `Entity ${e.id}`
        }));
      },
      error: () => {
        this.operatingEntities = [];
        this.operatingEntitySelectOptionsCached = [];
      }
    });
  }

  setOwnershipType(value: OwnershipType): void {
    if (this.formData.ownership_type === value) {
      return;
    }
    this.formData.ownership_type = value;
    delete this.errors.ownership_type;

    // Clear conditional-field errors as they're no longer relevant.
    delete this.errors.equipment_owner_name;
    delete this.errors.lessor_name;

    // Clear values from the now-hidden branches so we don't leak stale data
    // into the save payload.
    if (value !== 'oo') {
      this.formData.equipment_owner_name = '';
      this.formData.equipment_owner_id = '';
      this.formData.equipment_owner_percentage = null;
      this.formData.operating_entity_id = '';
      this.equipmentOwnerSearch = '';
      this.equipmentOwnerResults = [];
      this.equipmentOwnerDropdownOpen = false;
    }
    if (value !== 'leased') {
      this.formData.lessor_name = '';
      this.formData.lease_date = '';
      this.formData.lease_payment_amount = null;
    }
  }

  onEquipmentOwnerSearchInput(): void {
    const term = (this.equipmentOwnerSearch || '').trim();
    // The text the user types becomes the persisted name unless they pick
    // an existing payee — backend FN-1386 only requires `equipment_owner_name`,
    // so free-text typing is a valid path.
    this.formData.equipment_owner_name = this.equipmentOwnerSearch;
    this.formData.equipment_owner_id = '';
    delete this.errors.equipment_owner_name;
    this.equipmentOwnerDropdownOpen = true;

    if (this.equipmentOwnerSearchTimer) {
      clearTimeout(this.equipmentOwnerSearchTimer);
      this.equipmentOwnerSearchTimer = null;
    }

    if (term.length < 2) {
      this.equipmentOwnerResults = [];
      this.equipmentOwnerLoading = false;
      return;
    }

    this.equipmentOwnerLoading = true;
    this.equipmentOwnerSearchTimer = setTimeout(() => {
      this.apiService.searchPayees(term, 'all', 20).subscribe({
        next: (data: any) => {
          const list = Array.isArray(data) ? data : (Array.isArray(data?.payees) ? data.payees : []);
          this.equipmentOwnerResults = list
            .filter((p: any) => !p?.type || p.type === 'equipment_owner' || p.type === 'company' || p.type === 'individual')
            .slice(0, 20)
            .map((p: any) => ({ id: String(p.id || ''), name: p.name || p.display_name || 'Unknown' }))
            .filter((p: { id: string; name: string }) => p.name && p.name !== 'Unknown');
          this.equipmentOwnerLoading = false;
        },
        error: () => {
          this.equipmentOwnerResults = [];
          this.equipmentOwnerLoading = false;
        }
      });
    }, 250);
  }

  selectEquipmentOwner(option: { id: string; name: string }): void {
    this.formData.equipment_owner_name = option.name;
    this.formData.equipment_owner_id = option.id;
    this.equipmentOwnerSearch = option.name;
    this.equipmentOwnerDropdownOpen = false;
    delete this.errors.equipment_owner_name;
  }

  onEquipmentOwnerBlur(): void {
    // Defer so click on a dropdown item still registers before close.
    setTimeout(() => {
      this.equipmentOwnerDropdownOpen = false;
    }, 150);
  }

  toggleTrailerDetails(): void {
    this.trailerDetailsExpanded = !this.trailerDetailsExpanded;
  }

  onTrailerTypeSearchFocus(): void {
    this.trailerTypeDropdownOpen = true;
  }

  onTrailerTypeSearchInput(): void {
    this.trailerTypeDropdownOpen = true;
    this.trailerForm.trailer_type_code = '';
    this.trailerForm.trailer_type_label = '';
    this.updateFilteredTrailerTypeOptions();
  }

  onTrailerTypeSearchBlur(): void {
    setTimeout(() => {
      this.trailerTypeDropdownOpen = false;
      if (!this.trailerForm.trailer_type_code) {
        this.trailerTypeSearch = '';
      }
    }, 150);
  }

  private _filteredTrailerTypeOptionsCache: Array<{ id: string; value: string }> = this.trailerTypeOptions.slice(0, 40);

  get filteredTrailerTypeOptions(): Array<{ id: string; value: string }> {
    return this._filteredTrailerTypeOptionsCache;
  }

  private updateFilteredTrailerTypeOptions(): void {
    const q = (this.trailerTypeSearch || '').trim().toLowerCase();
    if (!q) {
      this._filteredTrailerTypeOptionsCache = this.trailerTypeOptions.slice(0, 40);
    } else {
      this._filteredTrailerTypeOptionsCache = this.trailerTypeOptions
        .filter((option) => option.id.toLowerCase().includes(q) || option.value.toLowerCase().includes(q))
        .slice(0, 80);
    }
  }

  selectTrailerType(option: { id: string; value: string }): void {
    this.trailerForm.trailer_type_code = option.id;
    this.trailerForm.trailer_type_label = option.value;
    this.trailerTypeSearch = `${option.id} — ${option.value}`;
    this.trailerTypeDropdownOpen = false;
  }

  private syncTrailerTypeSearchFromCurrent(): void {
    if (!this.trailerForm.trailer_type_code) {
      this.trailerTypeSearch = '';
      return;
    }

    const found = this.trailerTypeOptions.find((option) => option.id === this.trailerForm.trailer_type_code);
    const label = found?.value || this.trailerForm.trailer_type_label || '';
    this.trailerTypeSearch = label
      ? `${this.trailerForm.trailer_type_code} — ${label}`
      : this.trailerForm.trailer_type_code;
    this.trailerForm.trailer_type_label = label;
  }

  private static readonly MAKE_NORMALIZATION: Record<string, string> = {
    'VOLVO TRUCK': 'Volvo',
    'VOLVO': 'Volvo',
    'FREIGHTLINER': 'Freightliner',
    'DAIMLER TRUCKS NORTH AMERICA': 'Freightliner',
    'KENWORTH': 'Kenworth',
    'PETERBILT': 'Peterbilt',
    'MACK': 'Mack',
    'INTERNATIONAL': 'International',
    'NAVISTAR INTERNATIONAL': 'International',
    'NAVISTAR': 'International',
    'WESTERN STAR': 'Western Star',
    'WESTERN STAR TRUCKS': 'Western Star',
  };

  private normalizeMake(rawMake: string): string {
    const upper = rawMake.toUpperCase().trim();
    if (VehicleFormComponent.MAKE_NORMALIZATION[upper]) {
      return VehicleFormComponent.MAKE_NORMALIZATION[upper];
    }
    const caseMatch = this.makes.find(m => m.toLowerCase() === rawMake.toLowerCase().trim());
    if (caseMatch) return caseMatch;
    return rawMake;
  }

  private decodeVin(): void {
    const vin = (this.formData.vin || '').trim();
    if (vin.length !== 17) return;

    this.vinDecoding = true;
    this.vinDecodeMessage = '';
    this.apiService.decodeVin(vin).subscribe({
      next: (decoded) => {
        const yearValue = Number(decoded?.year);
        if (decoded?.make) this.formData.make = this.normalizeMake(decoded.make);
        if (decoded?.model) this.formData.model = decoded.model;
        if (Number.isFinite(yearValue) && yearValue > 1900) this.formData.year = yearValue;
        this.vinDecoding = false;
        this.vinDecodeMessage = decoded?.make || decoded?.model || decoded?.year
          ? 'VIN decoded successfully'
          : 'VIN decode returned limited data';
      },
      error: () => {
        this.vinDecoding = false;
        this.vinDecodeMessage = 'VIN decode unavailable';
      }
    });
  }

  onUnitNumberInput(): void {
    this.unitNumberManuallyEdited = true;
  }

  getDocIcon(type: string): string {
    return this.docIconMap[type] || 'description';
  }

  onFileSelect(event: Event, type: string): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.documents.push({
        type,
        name: file.name,
        file,
        uploaded_date: new Date().toISOString()
      });
    }
  }

  removeDocument(index: number): void {
    this.documents.splice(index, 1);
  }

  getExpiryStatus(expiryDate: string): 'valid' | 'warning' | 'expired' {
    if (!expiryDate) return 'valid';
    
    const expiry = new Date(expiryDate);
    const today = new Date();
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry <= 30) return 'warning';
    return 'valid';
  }

  getRegistrationStatus(): 'valid' | 'warning' | 'expired' {
    return this.getExpiryStatus(this.formData.registration_expiry);
  }

  getInspectionStatus(): 'valid' | 'warning' | 'expired' {
    return this.getExpiryStatus(this.formData.inspection_expiry);
  }

  validateForm(): boolean {
    this.errors = {};

    if (!this.formData.unit_number || !this.formData.unit_number.trim()) {
      this.errors.unit_number = 'Unit is required';
    }
    
    if (!this.formData.vin || this.formData.vin.length < 17) {
      this.errors.vin = 'VIN must be 17 characters';
    }

    if (this.isTrailerMode && !this.trailerForm.trailer_type_code) {
      this.errors.trailer_type = 'Trailer type is required';
    }

    if (!this.formData.make) {
      this.errors.make = 'Make is required';
    }

    if (!this.formData.model && !this.isTrailerMode) {
      this.errors.model = 'Model is required';
    }
    if (!this.formData.year || this.formData.year < 1990) {
      this.errors.year = 'Valid year is required';
    }
    if (!this.isTrailerMode) {
      if (!this.formData.license_plate) {
        this.errors.license_plate = 'License plate is required';
      }
      if (!this.formData.state) {
        this.errors.state = 'State is required';
      }
    }

    // FN-1387: ownership-conditional validation. Mirrors backend FN-1386
    // server-side checks so users see the error before round-tripping.
    if (this.formData.ownership_type === 'oo') {
      const ownerName = (this.formData.equipment_owner_name || '').trim();
      if (!ownerName) {
        this.errors.equipment_owner_name = 'Equipment Owner is required for OO';
      }
    } else if (this.formData.ownership_type === 'leased') {
      const lessor = (this.formData.lessor_name || '').trim();
      if (!lessor) {
        this.errors.lessor_name = 'Lessor Name is required for Leased';
      }
    }

    return Object.keys(this.errors).length === 0;
  }

  onSubmit(): void {
    if (!this.validateForm()) {
      return;
    }

    this.saving = true;

    const ownershipType: OwnershipType = this.formData.ownership_type || 'company';

    const vehicleData: any = {
      unit_number: this.formData.unit_number || '',
      vin: this.formData.vin || '',
      make: this.formData.make || '',
      model: this.formData.model || '',
      year: this.formData.year,
      license_plate: this.formData.license_plate || '',
      state: this.formData.state || '',
      status: this.formData.status || 'in-service',
      mileage: this.formData.mileage || 0,
      inspection_expiry: this.formData.inspection_expiry || null,
      next_pm_due: this.formData.next_pm_due || null,
      next_pm_mileage: this.formData.next_pm_mileage || null,
      insurance_expiry: this.formData.insurance_expiry || null,
      registration_expiry: this.formData.registration_expiry || null,
      oos_reason: this.formData.oos_reason || '',
      vehicle_type: this.formData.vehicle_type || this.vehicleType,
      // FN-1387: ownership classification — backend FN-1386 derives
      // `company_owned` from this enum so settlements stays in sync.
      ownership_type: ownershipType,
      equipment_owner_name: ownershipType === 'oo' ? (this.formData.equipment_owner_name || null) : null,
      equipment_owner_id: ownershipType === 'oo' && this.formData.equipment_owner_id
        ? this.formData.equipment_owner_id
        : null,
      equipment_owner_percentage: ownershipType === 'oo'
        ? (this.formData.equipment_owner_percentage ?? null)
        : null,
      operating_entity_id: ownershipType === 'oo' && this.formData.operating_entity_id
        ? this.formData.operating_entity_id
        : null,
      lessor_name: ownershipType === 'leased' ? (this.formData.lessor_name || null) : null,
      lease_date: ownershipType === 'leased' ? (this.formData.lease_date || null) : null,
      lease_payment_amount: ownershipType === 'leased'
        ? (this.formData.lease_payment_amount ?? null)
        : null
    };

    if (this.isTrailerMode) {
      // Mirror top-level lease fields into trailer_details so legacy readers
      // (and the backend's trailer-nested validator path) keep working.
      const mergedTrailer: TrailerDetails = {
        ...this.trailerForm,
        ownership: ownershipType === 'leased' ? 'leased' : 'owned',
        notes: this.trailerForm.notes || '',
        history: this.trailerForm.history || ''
      };
      if (ownershipType === 'leased') {
        mergedTrailer.lessor_name = this.formData.lessor_name || mergedTrailer.lessor_name || '';
        mergedTrailer.lease_date = this.formData.lease_date || mergedTrailer.lease_date || '';
      }
      vehicleData.trailer_details = mergedTrailer;
    }
    
    if (this.isEditMode && this.formData.id) {
      this.apiService.updateVehicle(this.formData.id, vehicleData).subscribe({
        next: (response) => {
          this.save.emit(response);
          this.saving = false;
          this.onClose();
        },
        error: (error) => {
          console.error('Error updating vehicle:', error);
          this.saving = false;
          this.errors.submit = error?.error?.message || error?.error?.error || 'Failed to update vehicle';
        }
      });
    } else {
      this.apiService.createVehicle(vehicleData).subscribe({
        next: (response) => {
          this.save.emit(response);
          this.saving = false;
          this.onClose();
        },
        error: (error) => {
          console.error('Error creating vehicle:', error);
          this.saving = false;
          this.errors.submit = error?.error?.message || error?.error?.error || 'Failed to create vehicle';
        }
      });
    }
  }

  onClose(): void {
    this.close.emit();
  }

  getDaysUntilExpiry(date: string): number {
    if (!date) return 999;
    const expiry = new Date(date);
    const today = new Date();
    return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  private getDefaultTrailerDetails(): TrailerDetails {
    return {
      trailer_type_code: '',
      trailer_type_label: '',
      assigned_driver_id: '',
      ownership: 'owned',
      purchase_date: '',
      purchase_price: null,
      lease_date: '',
      lessor_name: '',
      fid_number: '',
      address: '',
      address_line2: '',
      city: '',
      lease_state: '',
      zip: '',
      phone: '',
      notes: '',
      history: ''
    };
  }

  private parseTrailerDetails(value: any): Partial<TrailerDetails> {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}
