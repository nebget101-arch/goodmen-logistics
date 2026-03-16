import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';
import { LeaseFeaturePlanGuard } from './guards/lease-feature-plan.guard';
import { LeaseAgreementsListComponent } from './pages/lease-agreements-list/lease-agreements-list.component';
import { LeaseAgreementDetailComponent } from './pages/lease-agreement-detail/lease-agreement-detail.component';
import { LeaseAgreementFormComponent } from './pages/lease-agreement-form/lease-agreement-form.component';
import { LeaseFinancingDashboardComponent } from './pages/lease-financing-dashboard/lease-financing-dashboard.component';
import { LeaseUpgradeRequiredComponent } from './pages/lease-upgrade-required/lease-upgrade-required.component';
import { DriverLeaseViewComponent } from './pages/driver-lease-view/driver-lease-view.component';

const routes: Routes = [
  {
    path: '',
    canActivate: [AuthGuard, LeaseFeaturePlanGuard, PermissionGuard],
    data: {
      planPath: '/finance/lease-to-own',
      featureFlag: 'lease_to_own_financing',
      anyPermission: [
        PERMISSIONS.LEASE_FINANCING_VIEW,
        PERMISSIONS.LEASE_FINANCING_CREATE,
        PERMISSIONS.LEASE_FINANCING_EDIT,
        PERMISSIONS.LEASE_FINANCING_DASHBOARD_VIEW,
      ]
    },
    children: [
      { path: '', component: LeaseAgreementsListComponent },
      {
        path: 'dashboard',
        component: LeaseFinancingDashboardComponent,
        canActivate: [LeaseFeaturePlanGuard],
        data: { planPath: '/finance/fleet-financing-dashboard', featureFlag: 'fleet_financing_dashboard' }
      },
      { path: 'driver/me', component: DriverLeaseViewComponent },
      { path: 'new', component: LeaseAgreementFormComponent },
      { path: ':id/edit', component: LeaseAgreementFormComponent },
      { path: ':id', component: LeaseAgreementDetailComponent }
    ]
  },
  { path: 'upgrade', component: LeaseUpgradeRequiredComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LeaseFinancingRoutingModule {}
