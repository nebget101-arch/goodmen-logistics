import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AccessControlService } from '../services/access-control.service';

/**
 * FN-1425: Restricts a route to FleetNeuron-internal tenants. Non-internal users are
 * redirected to /dashboard so they never see a 403 — the route simply isn't available.
 */
@Injectable({ providedIn: 'root' })
export class InternalTenantGuard implements CanActivate {
  constructor(
    private readonly access: AccessControlService,
    private readonly router: Router
  ) {}

  canActivate(): boolean | UrlTree {
    if (this.access.canAccessFmcsaImportsAdmin()) {
      return true;
    }
    return this.router.createUrlTree(['/dashboard']);
  }
}
