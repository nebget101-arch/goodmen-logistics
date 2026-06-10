import {
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Vendor, VendorsService } from '../../../../services/vendors.service';

@Component({
  selector: 'app-vendors-list',
  templateUrl: './vendors-list.component.html',
  styleUrls: ['./vendors-list.component.css'],
})
export class VendorsListComponent implements OnInit, OnDestroy {
  @Output() readonly createVendor = new EventEmitter<void>();
  @Output() readonly editVendor = new EventEmitter<Vendor>();

  loading = false;
  vendors: Vendor[] = [];
  error = '';
  message = '';

  statusFilter: '' | 'active' | 'suspended' = '';
  togglingId: string | null = null;

  private listSub: Subscription | null = null;
  private toggleSub: Subscription | null = null;
  private confirmTarget: Vendor | null = null;
  confirmOpen = false;

  constructor(private readonly svc: VendorsService) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.listSub?.unsubscribe();
    this.toggleSub?.unsubscribe();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.listSub?.unsubscribe();
    this.listSub = this.svc.listVendors(
      this.statusFilter ? { status: this.statusFilter } : undefined
    ).subscribe({
      next: (vendors) => {
        this.vendors = vendors;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || err?.error?.message || 'Failed to load vendors.';
        this.loading = false;
      },
    });
  }

  applyFilter(value: '' | 'active' | 'suspended'): void {
    this.statusFilter = value;
    this.load();
  }

  onEdit(vendor: Vendor): void {
    this.editVendor.emit(vendor);
  }

  openToggleConfirm(vendor: Vendor): void {
    if (this.togglingId) return;
    this.confirmTarget = vendor;
    this.confirmOpen = true;
  }

  closeConfirm(): void {
    if (this.togglingId) return;
    this.confirmOpen = false;
    this.confirmTarget = null;
  }

  confirmToggle(): void {
    if (!this.confirmTarget || this.togglingId) return;
    const vendor = this.confirmTarget;
    const next = vendor.status === 'active' ? 'suspended' : 'active';
    this.togglingId = vendor.vendor_id;
    this.confirmOpen = false;
    this.confirmTarget = null;
    this.toggleSub?.unsubscribe();
    this.toggleSub = this.svc.setVendorStatus(vendor.vendor_id, next).subscribe({
      next: (updated) => {
        this.vendors = this.vendors.map((v) =>
          v.vendor_id === updated.vendor_id ? updated : v
        );
        this.togglingId = null;
        this.flash(next === 'suspended' ? `${vendor.name} suspended.` : `${vendor.name} reactivated.`);
        if (this.statusFilter && updated.status !== this.statusFilter) {
          this.vendors = this.vendors.filter((v) => v.vendor_id !== updated.vendor_id);
        }
      },
      error: (err) => {
        this.error = err?.error?.error || err?.error?.message || 'Failed to update vendor status.';
        this.togglingId = null;
      },
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmOpen) this.closeConfirm();
  }

  locationLabel(vendor: Vendor): string {
    if (!vendor.base_location) return '—';
    const { lat, lng } = vendor.base_location;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  skillsLabel(vendor: Vendor): string {
    if (!vendor.skills?.length) return '—';
    return vendor.skills.join(', ');
  }

  private flash(text: string, ms = 4000): void {
    this.message = text;
    setTimeout(() => {
      if (this.message === text) this.message = '';
    }, ms);
  }
}
