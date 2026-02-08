import { Component, EventEmitter, Input, OnInit, OnChanges, SimpleChanges, Output } from '@angular/core';
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
export class VehicleFormComponent implements OnInit, OnChanges {
  @Input() vehicle: any = null;
  @Input() isOpen = false;
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
    oos_reason: ''
  };

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

  makes = ['Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'Mack', 'International', 'Western Star'];
  
  isEditMode = false;
  saving = false;
  errors: any = {};
  submitted = false;

  constructor(private apiService: ApiService) {}

  ngOnInit(): void {
    this.loadFormData();
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
        oos_reason: ''
      };
    }
  }

  onVinChange(): void {
    if (this.formData.vin && this.formData.vin.length >= 4) {
      const last4 = this.formData.vin.slice(-4);
      const nextNumber = this.getNextUnitNumber();
      this.formData.unit_number = `TRK-${nextNumber}`;
    }
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
    
    if (!this.formData.vin || this.formData.vin.length < 17) {
      this.errors.vin = 'VIN must be 17 characters';
    }
    if (!this.formData.make) {
      this.errors.make = 'Make is required';
    }
    if (!this.formData.model) {
      this.errors.model = 'Model is required';
    }
    if (!this.formData.year || this.formData.year < 1990) {
      this.errors.year = 'Valid year is required';
    }
    if (!this.formData.license_plate) {
      this.errors.license_plate = 'License plate is required';
    }
    if (!this.formData.state) {
      this.errors.state = 'State is required';
    }

    return Object.keys(this.errors).length === 0;
  }

  onSubmit(): void {
    if (!this.validateForm()) {
      return;
    }

    this.saving = true;
    
    const vehicleData = { ...this.formData };
    
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
          this.errors.submit = 'Failed to update vehicle';
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
          this.errors.submit = 'Failed to create vehicle';
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
}
