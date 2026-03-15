/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AccessControlService } from './access-control.service';
import { PERMISSIONS } from '../models/access-control.model';

describe('AccessControlService RBAC compatibility', () => {
  let service: AccessControlService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AccessControlService]
    });
    service = TestBed.inject(AccessControlService);
    service.clearAccess();
  });

  it('keeps admin navigation capabilities', () => {
    service.setAccessFromLoginResponse({ role: 'admin', user: { id: 'u1' } });

    expect(service.canSee('dashboard')).toBeTrue();
    expect(service.canSee('loads')).toBeTrue();
    expect(service.canSee('customers')).toBeTrue();
    expect(service.canSee('settlements')).toBeTrue();
    expect(service.hasPermission(PERMISSIONS.USERS_EDIT)).toBeTrue();
  });

  it('keeps dispatcher navigation behavior', () => {
    service.setAccessFromLoginResponse({ role: 'dispatcher', user: { id: 'u2' } });

    expect(service.canSee('loads')).toBeTrue();
    expect(service.canSee('drivers')).toBeTrue();
    expect(service.canSee('settlements')).toBeFalse();
  });

  it('enables shop_clerk intake screens and hides restricted menus', () => {
    service.setAccessFromLoginResponse({ role: 'shop_clerk', user: { id: 'u3' } });

    expect(service.canSee('customers')).toBeTrue();
    expect(service.canSee('maintenance')).toBeTrue();
    expect(service.canSee('vehicles')).toBeTrue();
    expect(service.canSee('invoices')).toBeTrue();

    expect(service.canSee('users_create')).toBeFalse();
    expect(service.canSee('settlements')).toBeFalse();
    expect(service.canSee('transfers')).toBeFalse();
    expect(service.canSee('inventory_reports')).toBeFalse();
  });

  it('treats company_admin as admin-compatible', () => {
    service.setAccessFromLoginResponse({ role: 'company_admin', user: { id: 'u4' } });

    expect(service.hasPermission(PERMISSIONS.USERS_CREATE)).toBeTrue();
    expect(service.hasPermission(PERMISSIONS.ROLES_MANAGE)).toBeTrue();
  });

  it('prefers backend permissions when provided', () => {
    service.setAccessFromLoginResponse({
      role: 'driver',
      user: { id: 'u5' },
      permissions: [PERMISSIONS.CUSTOMERS_VIEW]
    });

    expect(service.hasPermission(PERMISSIONS.CUSTOMERS_VIEW)).toBeTrue();
    expect(service.hasPermission(PERMISSIONS.LOADS_VIEW)).toBeFalse();
  });

  it('derives permissions from roles when backend sends an empty permissions array', () => {
    service.setAccessFromLoginResponse({
      roles: ['dispatcher', 'dispatch_manager'],
      user: { id: 'u6' },
      permissions: []
    });

    expect(service.canSee('loads')).toBeTrue();
    expect(service.canSee('drivers')).toBeTrue();
    expect(service.canSee('settlements')).toBeFalse();
  });
});
