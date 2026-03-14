import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { AccessControlService } from '../services/access-control.service';

@Injectable({ providedIn: 'root' })
export class PlanGuard implements CanActivate {
  constructor(
    private access: AccessControlService,
    private router: Router
  ) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const targetUrl = route.data['planPath'] as string | undefined;
    const pathToCheck = targetUrl || state.url;

    if (this.access.canAccessUrl(pathToCheck)) {
      return true;
    }

    return this.router.createUrlTree(['/dashboard'], {
      queryParams: { denied: 'plan' }
    });
  }
}
