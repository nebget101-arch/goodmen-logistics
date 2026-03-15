import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PermissionGuard } from './permission.guard';
import { AccessControlService } from '../services/access-control.service';
import { PERMISSIONS } from '../models/access-control.model';

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let access: AccessControlService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes([]), HttpClientTestingModule],
      providers: [PermissionGuard, AccessControlService]
    });

    guard = TestBed.inject(PermissionGuard);
    access = TestBed.inject(AccessControlService);
    router = TestBed.inject(Router);
    access.clearAccess();
  });

  it('allows route when anyPermission matches', () => {
    access.setAccess({
      user: { id: 'u1' },
      roles: [],
      permissions: [PERMISSIONS.CUSTOMERS_VIEW],
      locations: []
    });

    const route: any = { data: { anyPermission: [PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_EDIT] } };
    const result = guard.canActivate(route, { url: '/customers' } as any);

    expect(result).toBeTrue();
  });

  it('blocks route when no required permission is granted', () => {
    access.setAccess({
      user: { id: 'u2' },
      roles: ['shop_clerk'],
      permissions: [PERMISSIONS.CUSTOMERS_VIEW],
      locations: []
    });

    const route: any = { data: { permission: PERMISSIONS.ROLES_MANAGE } };
    const result = guard.canActivate(route, { url: '/admin/multi-mc' } as any);

    expect(result).not.toBeTrue();
    expect((result as any).toString()).toContain('/dashboard');
  });

  it('supports allPermission route checks', () => {
    access.setAccess({
      user: { id: 'u3' },
      roles: [],
      permissions: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.PAYMENTS_CREATE],
      locations: []
    });

    const route: any = { data: { allPermission: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.PAYMENTS_CREATE] } };
    const result = guard.canActivate(route, { url: '/invoices/1' } as any);

    expect(result).toBeTrue();
  });
});
