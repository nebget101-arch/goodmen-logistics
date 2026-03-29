import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

import { SafetyShellComponent } from './safety-shell/safety-shell.component';
import { SafetyOverviewComponent } from './safety-overview/safety-overview.component';
import { SafetyAccidentsComponent } from './safety-accidents/safety-accidents.component';
import { SafetyAccidentDetailComponent } from './safety-accident-detail/safety-accident-detail.component';
import { SafetyClaimsComponent } from './safety-claims/safety-claims.component';
import { SafetyTasksComponent } from './safety-tasks/safety-tasks.component';
import { SafetyReportsComponent } from './safety-reports/safety-reports.component';
import { ComplianceDashboardComponent } from './compliance-dashboard/compliance-dashboard.component';
import { FmcsaDashboardComponent } from './fmcsa-dashboard/fmcsa-dashboard.component';
import { FmcsaCarriersComponent } from './fmcsa-carriers/fmcsa-carriers.component';
import { FmcsaCarrierDetailComponent } from './fmcsa-carrier-detail/fmcsa-carrier-detail.component';
import { RiskDashboardComponent } from './risk-dashboard/risk-dashboard.component';
import { DriverRiskTimelineComponent } from './driver-risk-timeline/driver-risk-timeline.component';

const SAFETY_PERMS = [
  PERMISSIONS.SAFETY_INCIDENTS_VIEW,
  PERMISSIONS.SAFETY_INCIDENTS_CREATE,
  PERMISSIONS.SAFETY_CLAIMS_VIEW,
  PERMISSIONS.SAFETY_REPORTS_VIEW,
  PERMISSIONS.FMCSA_SAFETY_VIEW,
];

const routes: Routes = [
  // Compliance — standalone page (no Claims & Accidents shell)
  {
    path: 'compliance',
    component: ComplianceDashboardComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  // FMCSA Safety — standalone pages (no Claims & Accidents shell)
  {
    path: 'fmcsa',
    component: FmcsaDashboardComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  {
    path: 'fmcsa/carriers',
    component: FmcsaCarriersComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  {
    path: 'fmcsa/carriers/:id',
    component: FmcsaCarrierDetailComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  // Driver Risk Scores
  {
    path: 'risk-scores',
    component: RiskDashboardComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  {
    path: 'risk-scores/:driverId',
    component: DriverRiskTimelineComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
  },
  // Claims & Accidents — shell with tabs
  {
    path: '',
    component: SafetyShellComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: SAFETY_PERMS },
    children: [
      { path: '', component: SafetyOverviewComponent },
      { path: 'accidents', component: SafetyAccidentsComponent },
      { path: 'accidents/:id', component: SafetyAccidentDetailComponent },
      { path: 'claims', component: SafetyClaimsComponent },
      { path: 'tasks', component: SafetyTasksComponent },
      { path: 'reports', component: SafetyReportsComponent },
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SafetyRoutingModule {}
