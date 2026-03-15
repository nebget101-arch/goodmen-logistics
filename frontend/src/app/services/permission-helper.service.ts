import { Injectable } from '@angular/core';
import { AccessControlService } from './access-control.service';
import { ROLES } from '../models/access-control.model';

/**
 * Thin compatibility wrapper for permission/role checks.
 * Keeps legacy checks working while giving components/guards
 * a single, typed RBAC helper API.
 */
@Injectable({ providedIn: 'root' })
export class PermissionHelperService {
  constructor(private readonly access: AccessControlService) {}

  hasRole(role: string): boolean {
    const normalized = String(role || '').toLowerCase().trim();
    if (!normalized) return false;

    // Backward-compatible admin aliases
    if (normalized === ROLES.ADMIN || normalized === ROLES.COMPANY_ADMIN) {
      return this.access.hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COMPANY_ADMIN]);
    }

    return this.access.hasRole(normalized);
  }

  hasPermission(permission: string): boolean {
    return this.access.hasPermission(permission);
  }

  hasAnyPermission(permissions: string[]): boolean {
    return this.access.hasAnyPermission(permissions || []);
  }

  /**
   * Scoped check strategy (backward compatible):
   * 1) true when base permission is granted globally
   * 2) true when explicit scoped permission string exists:
   *    - "permission:scope"
   *    - "permission.scope"
   * 3) true when access payload includes permissionScopes[permission] containing scope
   */
  hasScopedPermission(permission: string, scope: string): boolean {
    const perm = String(permission || '').trim();
    const sc = String(scope || '').trim();
    if (!perm || !sc) return false;

    if (this.hasPermission(perm)) return true;

    const all = this.access.getPermissions();
    if (all.includes(`${perm}:${sc}`) || all.includes(`${perm}.${sc}`)) {
      return true;
    }

    const map = this.access.getAccess()?.permissionScopes;
    if (!map || !Array.isArray(map[perm])) return false;
    return map[perm].includes(sc);
  }
}
