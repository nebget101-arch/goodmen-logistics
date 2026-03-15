import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { AccessControlService } from './access-control.service';
import { PermissionHelperService } from './permission-helper.service';
import { PERMISSIONS } from '../models/access-control.model';

describe('PermissionHelperService', () => {
  let access: AccessControlService;
  let helper: PermissionHelperService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AccessControlService, PermissionHelperService]
    });
    access = TestBed.inject(AccessControlService);
    helper = TestBed.inject(PermissionHelperService);
    access.clearAccess();
  });

  it('returns true for scoped permission when base permission exists', () => {
    access.setAccess({
      user: { id: 'u1' },
      roles: ['shop_manager'],
      permissions: [PERMISSIONS.INVOICES_VIEW],
      locations: []
    });

    expect(helper.hasScopedPermission(PERMISSIONS.INVOICES_VIEW, 'location:1')).toBeTrue();
  });

  it('returns true for scoped permission suffix notation', () => {
    access.setAccess({
      user: { id: 'u2' },
      roles: [],
      permissions: ['invoices.view:location:abc'],
      locations: []
    });

    expect(helper.hasScopedPermission('invoices.view', 'location:abc')).toBeTrue();
  });

  it('returns true for scoped map from access payload', () => {
    access.setAccess({
      user: { id: 'u3' },
      roles: [],
      permissions: [],
      permissionScopes: {
        'invoices.view': ['location:xyz']
      },
      locations: []
    });

    expect(helper.hasScopedPermission('invoices.view', 'location:xyz')).toBeTrue();
  });
});
