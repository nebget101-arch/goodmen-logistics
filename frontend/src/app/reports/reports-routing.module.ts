import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReportsShellComponent } from './pages/reports-shell/reports-shell.component';
import { ReportViewComponent } from './pages/report-view/report-view.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

const routes: Routes = [
  {
    path: '',
    component: ReportsShellComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/reports', anyPermission: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_SHOP] },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: ReportViewComponent, data: { reportKey: 'overview' } },
      { path: 'emails', component: ReportViewComponent, data: { reportKey: 'emails' } },
      { path: 'total-revenue', component: ReportViewComponent, data: { reportKey: 'total-revenue' } },
      { path: 'rate-per-mile', component: ReportViewComponent, data: { reportKey: 'rate-per-mile' } },
      { path: 'revenue-by-dispatcher', component: ReportViewComponent, data: { reportKey: 'revenue-by-dispatcher' } },
      { path: 'payment-summary', component: ReportViewComponent, data: { reportKey: 'payment-summary' } },
      { path: 'expenses', component: ReportViewComponent, data: { reportKey: 'expenses' } },
      { path: 'gross-profit', component: ReportViewComponent, data: { reportKey: 'gross-profit' } },
      { path: 'gross-profit-per-load', component: ReportViewComponent, data: { reportKey: 'gross-profit-per-load' } },
      { path: 'profit-loss', component: ReportViewComponent, data: { reportKey: 'profit-loss' } },
      { path: 'direct-load-profit', component: ReportViewComponent, data: { reportKey: 'direct-load-profit' } },
      { path: 'fully-loaded-profit', component: ReportViewComponent, data: { reportKey: 'fully-loaded-profit' } }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ReportsRoutingModule {}
