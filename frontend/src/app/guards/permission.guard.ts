import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { PermissionHelperService } from '../services/permission-helper.service';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  constructor(
    private permissions: PermissionHelperService,
    private router: Router
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const permission = route.data['permission'] as string | undefined;
    const anyPermission = route.data['anyPermission'] as string[] | undefined;
    const allPermission = route.data['allPermission'] as string[] | undefined;
    const role = route.data['role'] as string | undefined;
    const anyRole = route.data['anyRole'] as string[] | undefined;
    const scopedPermission = route.data['scopedPermission'] as { permission?: string; scope?: string } | undefined;

    if (permission && this.permissions.hasPermission(permission)) return true;
    if (anyPermission?.length && this.permissions.hasAnyPermission(anyPermission)) return true;
    if (allPermission?.length && allPermission.every((code) => this.permissions.hasPermission(code))) return true;
    if (role && this.permissions.hasRole(role)) return true;
    if (anyRole?.length && anyRole.some((r) => this.permissions.hasRole(r))) return true;
    if (scopedPermission?.permission && scopedPermission?.scope
      && this.permissions.hasScopedPermission(scopedPermission.permission, scopedPermission.scope)) {
      return true;
    }

    if (
      !permission
      && !anyPermission?.length
      && !allPermission?.length
      && !role
      && !anyRole?.length
      && !scopedPermission
    ) {
      return true;
    }

    return this.router.createUrlTree(['/dashboard']);
  }
}
