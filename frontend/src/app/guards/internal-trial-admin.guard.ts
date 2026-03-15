import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AccessControlService } from '../services/access-control.service';

@Injectable({ providedIn: 'root' })
export class InternalTrialAdminGuard implements CanActivate {
  constructor(
    private readonly access: AccessControlService,
    private readonly router: Router
  ) {}

  canActivate(): boolean | UrlTree {
    if (this.access.canAccessTrialRequestsAdmin()) {
      return true;
    }

    return this.router.createUrlTree(['/dashboard']);
  }
}
