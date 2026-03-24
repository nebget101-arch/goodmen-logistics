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

const SAFETY_PERMS = [
  PERMISSIONS.SAFETY_INCIDENTS_VIEW,
  PERMISSIONS.SAFETY_INCIDENTS_CREATE,
  PERMISSIONS.SAFETY_CLAIMS_VIEW,
  PERMISSIONS.SAFETY_REPORTS_VIEW,
];

const routes: Routes = [
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
      { path: 'compliance', component: ComplianceDashboardComponent },
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SafetyRoutingModule {}
