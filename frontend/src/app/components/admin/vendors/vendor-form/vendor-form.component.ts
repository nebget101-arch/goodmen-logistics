import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Vendor, VendorPayload, VendorsService } from '../../../../services/vendors.service';

export const VENDOR_SKILLS: readonly string[] = [
  'Towing',
  'Heavy Duty Towing',
  'Tire Change',
  'Fuel Delivery',
  'Lockout Service',
  'Battery Jump',
  'Accident Recovery',
  'Light Mechanical',
  'Winching',
  'Flatbed Transport',
];

@Component({
  selector: 'app-vendor-form',
  templateUrl: './vendor-form.component.html',
  styleUrls: ['./vendor-form.component.css'],
})
export class VendorFormComponent implements OnChanges {
  @Input() vendor: Vendor | null = null;
  @Output() readonly saved = new EventEmitter<Vendor>();
  @Output() readonly cancelled = new EventEmitter<void>();

  readonly skillOptions = VENDOR_SKILLS;

  name = '';
  selectedSkills: Record<string, boolean> = {};
  capacity = 1;
  latInput = '';
  lngInput = '';
  submitting = false;
  error = '';

  private saveSub: Subscription | null = null;

  constructor(private readonly svc: VendorsService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['vendor']) {
      this.reset();
    }
  }

  get isEdit(): boolean {
    return !!this.vendor;
  }

  get title(): string {
    return this.vendor ? 'Edit vendor' : 'Add vendor';
  }

  reset(): void {
    this.error = '';
    this.submitting = false;
    if (this.vendor) {
      this.name = this.vendor.name;
      this.capacity = this.vendor.capacity ?? 1;
      this.selectedSkills = {};
      for (const sk of this.skillOptions) {
        this.selectedSkills[sk] = (this.vendor.skills ?? []).includes(sk);
      }
      this.latInput = this.vendor.base_location ? String(this.vendor.base_location.lat) : '';
      this.lngInput = this.vendor.base_location ? String(this.vendor.base_location.lng) : '';
    } else {
      this.name = '';
      this.capacity = 1;
      this.selectedSkills = {};
      for (const sk of this.skillOptions) {
        this.selectedSkills[sk] = false;
      }
      this.latInput = '';
      this.lngInput = '';
    }
  }

  toggleSkill(skill: string): void {
    this.selectedSkills[skill] = !this.selectedSkills[skill];
  }

  selectedSkillsList(): string[] {
    return this.skillOptions.filter((sk) => this.selectedSkills[sk]);
  }

  parseLocation(): { lat: number; lng: number } | null {
    const lat = parseFloat(this.latInput);
    const lng = parseFloat(this.lngInput);
    if (!this.latInput.trim() && !this.lngInput.trim()) return null;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  validate(): string {
    if (!(this.name ?? '').trim()) return 'Vendor name is required.';
    if (!Number.isInteger(this.capacity) || this.capacity < 1) return 'Capacity must be a positive integer.';
    const latTrimmed = this.latInput.trim();
    const lngTrimmed = this.lngInput.trim();
    if (latTrimmed || lngTrimmed) {
      const lat = parseFloat(latTrimmed);
      const lng = parseFloat(lngTrimmed);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.';
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.';
    }
    return '';
  }

  submit(): void {
    if (this.submitting) return;
    const validationError = this.validate();
    if (validationError) {
      this.error = validationError;
      return;
    }
    this.error = '';
    this.submitting = true;
    const payload: VendorPayload = {
      name: this.name.trim(),
      skills: this.selectedSkillsList(),
      capacity: this.capacity,
      base_location: this.parseLocation(),
    };
    this.saveSub?.unsubscribe();
    if (this.vendor) {
      this.saveSub = this.svc.updateVendor(this.vendor.vendor_id, payload).subscribe({
        next: (updated) => {
          this.submitting = false;
          this.saved.emit(updated);
        },
        error: (err) => {
          this.submitting = false;
          this.error = err?.error?.error || err?.error?.message || 'Failed to update vendor.';
        },
      });
    } else {
      this.saveSub = this.svc.createVendor(payload).subscribe({
        next: (created) => {
          this.submitting = false;
          this.saved.emit(created);
        },
        error: (err) => {
          this.submitting = false;
          this.error = err?.error?.error || err?.error?.message || 'Failed to create vendor.';
        },
      });
    }
  }

  cancel(): void {
    if (this.submitting) return;
    this.saveSub?.unsubscribe();
    this.cancelled.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancel();
  }
}
