import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AccessControlService } from '../../services/access-control.service';

@Injectable({ providedIn: 'root' })
export class LeaseFeaturePlanGuard implements CanActivate {
  constructor(private access: AccessControlService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
    const planPath = route.data['planPath'] as string | undefined;
    const featureFlag = route.data['featureFlag'] as string | undefined;
    const hasPathAccess = this.access.canAccessUrl(planPath || state.url);
    const hasFeatureAccess = featureFlag ? this.access.hasFeatureAccess(featureFlag) : true;

    if (hasPathAccess && hasFeatureAccess) return true;

    return this.router.createUrlTree(['/finance/lease-to-own/upgrade'], {
      queryParams: {
        denied: 'plan',
        feature: featureFlag || 'lease_to_own_financing'
      }
    });
  }
}
