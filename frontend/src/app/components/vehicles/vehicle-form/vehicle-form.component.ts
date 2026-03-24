import { Component, EventEmitter, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, Output } from '@angular/core';
import { ApiService } from '../../../services/api.service';

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
    vehicle_type: 'truck'
  };

  trailerForm: TrailerDetails = this.getDefaultTrailerDetails();
  drivers: any[] = [];
  trailerTypeSearch = '';
  trailerTypeDropdownOpen = false;
  vinDecoding = false;
  vinDecodeMessage = '';
  private vinDecodeTimer: ReturnType<typeof setTimeout> | null = null;

  documents: Document[] = [];
  
  documentTypes = [
    { value: 'inspection', label: 'Annual Inspection' },
    { value: 'registration', label: 'Registration' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'maintenance', label: 'Repairs & Maintenance' },
    { value: 'other', label: 'Other Documents' }
  ];

  states = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ];

  get stateSelectOptions(): { value: string; label: string }[] {
    return this.states.map(s => ({ value: s, label: s }));
  }

  get driverSelectOptions(): { value: string; label: string }[] {
    return this.drivers.map(d => ({ value: d.id, label: `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unknown' }));
  }

  get makeSelectOptions(): { value: string; label: string }[] {
    return this.makes.map(m => ({ value: m, label: m }));
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
    this.loadDrivers();
    this.loadFormData();
  }

  ngOnDestroy(): void {
    if (this.vinDecodeTimer) {
      clearTimeout(this.vinDecodeTimer);
      this.vinDecodeTimer = null;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vehicle'] || changes['isOpen']) {
      this.loadFormData();
      this.submitted = false;
      this.errors = {};
    }
  }

  loadFormData(): void {
    if (this.vehicle) {
      this.isEditMode = true;
      this.formData = { ...this.vehicle };
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
    } else {
      this.isEditMode = false;
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
        vehicle_type: this.vehicleType
      };
      this.trailerForm = this.getDefaultTrailerDetails();
      this.trailerTypeSearch = '';
    }
  }

  onVinChange(): void {
    const vin = (this.formData.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.formData.vin = vin;

    if (vin && vin.length >= 4 && !this.formData.unit_number) {
      const nextNumber = this.getNextUnitNumber();
      const prefix = (this.formData.vehicle_type || this.vehicleType) === 'trailer' ? 'TRL' : 'TRK';
      this.formData.unit_number = `${prefix}-${nextNumber}`;
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
      },
      error: () => {
        this.drivers = [];
      }
    });
  }

  onTrailerTypeSearchFocus(): void {
    this.trailerTypeDropdownOpen = true;
  }

  onTrailerTypeSearchInput(): void {
    this.trailerTypeDropdownOpen = true;
    this.trailerForm.trailer_type_code = '';
    this.trailerForm.trailer_type_label = '';
  }

  onTrailerTypeSearchBlur(): void {
    setTimeout(() => {
      this.trailerTypeDropdownOpen = false;
      if (!this.trailerForm.trailer_type_code) {
        this.trailerTypeSearch = '';
      }
    }, 150);
  }

  get filteredTrailerTypeOptions(): Array<{ id: string; value: string }> {
    const q = (this.trailerTypeSearch || '').trim().toLowerCase();
    if (!q) return this.trailerTypeOptions.slice(0, 40);
    return this.trailerTypeOptions
      .filter((option) => option.id.toLowerCase().includes(q) || option.value.toLowerCase().includes(q))
      .slice(0, 80);
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

  private decodeVin(): void {
    const vin = (this.formData.vin || '').trim();
    if (vin.length !== 17) return;

    this.vinDecoding = true;
    this.vinDecodeMessage = '';
    this.apiService.decodeVin(vin).subscribe({
      next: (decoded) => {
        const yearValue = Number(decoded?.year);
        if (decoded?.make) this.formData.make = decoded.make;
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

  getNextUnitNumber(): string {
    // This would typically come from the backend
    const timestamp = Date.now().toString().slice(-3);
    return timestamp.padStart(3, '0');
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

    return Object.keys(this.errors).length === 0;
  }

  onSubmit(): void {
    if (!this.validateForm()) {
      return;
    }

    this.saving = true;

    const vehicleData: any = {
      unit_number: this.formData.unit_number,
      vin: this.formData.vin,
      make: this.formData.make,
      model: this.formData.model,
      year: this.formData.year,
      license_plate: this.formData.license_plate || null,
      state: this.formData.state || null,
      status: this.formData.status || 'in-service',
      mileage: this.formData.mileage || 0,
      inspection_expiry: this.formData.inspection_expiry || null,
      next_pm_due: this.formData.next_pm_due || null,
      next_pm_mileage: this.formData.next_pm_mileage || null,
      insurance_expiry: this.formData.insurance_expiry || null,
      registration_expiry: this.formData.registration_expiry || null,
      oos_reason: this.formData.oos_reason || null,
      vehicle_type: this.formData.vehicle_type || this.vehicleType
    };

    if (this.isTrailerMode) {
      vehicleData.trailer_details = {
        ...this.trailerForm,
        notes: this.trailerForm.notes || '',
        history: this.trailerForm.history || ''
      };
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
