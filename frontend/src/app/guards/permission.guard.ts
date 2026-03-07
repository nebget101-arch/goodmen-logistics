import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { AccessControlService } from '../services/access-control.service';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  constructor(
    private access: AccessControlService,
    private router: Router
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const permission = route.data['permission'] as string | undefined;
    const anyPermission = route.data['anyPermission'] as string[] | undefined;

    if (permission && this.access.hasPermission(permission)) return true;
    if (anyPermission?.length && this.access.hasAnyPermission(anyPermission)) return true;
    if (!permission && !anyPermission?.length) return true;

    return this.router.createUrlTree(['/dashboard']);
  }
}
