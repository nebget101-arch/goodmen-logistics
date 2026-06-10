import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { VendorsListComponent } from './vendors-list.component';
import { VendorsService, Vendor } from '../../../../services/vendors.service';

const MOCK_VENDOR: Vendor = {
  vendor_id: 'v1',
  tenant_id: 't1',
  name: 'Ace Towing',
  skills: ['Towing', 'Tire Change'],
  capacity: 3,
  base_location: { lat: 29.76, lng: -95.37 },
  status: 'active',
};

const MOCK_SUSPENDED: Vendor = {
  ...MOCK_VENDOR,
  vendor_id: 'v2',
  name: 'Bob Recovery',
  status: 'suspended',
};

describe('VendorsListComponent', () => {
  let component: VendorsListComponent;
  let fixture: ComponentFixture<VendorsListComponent>;
  let svc: jasmine.SpyObj<VendorsService>;

  beforeEach(async () => {
    svc = jasmine.createSpyObj('VendorsService', ['listVendors', 'setVendorStatus']);
    svc.listVendors.and.returnValue(of([MOCK_VENDOR, MOCK_SUSPENDED]));

    await TestBed.configureTestingModule({
      declarations: [VendorsListComponent],
      imports: [CommonModule],
      providers: [{ provide: VendorsService, useValue: svc }],
    }).compileComponents();

    fixture = TestBed.createComponent(VendorsListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads vendors on init', () => {
    expect(svc.listVendors).toHaveBeenCalledTimes(1);
    expect(component.vendors.length).toBe(2);
    expect(component.loading).toBeFalse();
  });

  it('shows error when load fails', () => {
    svc.listVendors.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
    component.load();
    expect(component.error).toBe('Server error');
    expect(component.loading).toBeFalse();
  });

  it('filters by active status', () => {
    svc.listVendors.and.returnValue(of([MOCK_VENDOR]));
    component.applyFilter('active');
    expect(svc.listVendors).toHaveBeenCalledWith({ status: 'active' });
    expect(component.statusFilter).toBe('active');
  });

  it('emits editVendor when edit is clicked', () => {
    const emitted: Vendor[] = [];
    component.editVendor.subscribe((v) => emitted.push(v));
    component.onEdit(MOCK_VENDOR);
    expect(emitted).toEqual([MOCK_VENDOR]);
  });

  it('opens confirm dialog on toggle', () => {
    component.openToggleConfirm(MOCK_VENDOR);
    expect(component.confirmOpen).toBeTrue();
  });

  it('closes confirm dialog on cancel', () => {
    component.openToggleConfirm(MOCK_VENDOR);
    component.closeConfirm();
    expect(component.confirmOpen).toBeFalse();
  });

  it('calls setVendorStatus with suspended when active vendor is toggled', () => {
    svc.setVendorStatus.and.returnValue(of({ ...MOCK_VENDOR, status: 'suspended' }));
    component.openToggleConfirm(MOCK_VENDOR);
    component.confirmToggle();
    expect(svc.setVendorStatus).toHaveBeenCalledWith('v1', 'suspended');
  });

  it('calls setVendorStatus with active when suspended vendor is toggled', () => {
    svc.setVendorStatus.and.returnValue(of({ ...MOCK_SUSPENDED, status: 'active' }));
    component.openToggleConfirm(MOCK_SUSPENDED);
    component.confirmToggle();
    expect(svc.setVendorStatus).toHaveBeenCalledWith('v2', 'active');
  });

  it('formats location label correctly', () => {
    expect(component.locationLabel(MOCK_VENDOR)).toBe('29.7600, -95.3700');
  });

  it('returns dash for null location', () => {
    expect(component.locationLabel({ ...MOCK_VENDOR, base_location: null })).toBe('—');
  });

  it('formats skills label', () => {
    expect(component.skillsLabel(MOCK_VENDOR)).toBe('Towing, Tire Change');
  });

  it('returns dash for empty skills', () => {
    expect(component.skillsLabel({ ...MOCK_VENDOR, skills: [] })).toBe('—');
  });
});
