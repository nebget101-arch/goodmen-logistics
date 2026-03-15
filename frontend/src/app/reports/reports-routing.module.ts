import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

const routes: Routes = [
  {
    path: '',
    component: ReportsPageComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/reports', anyPermission: [PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_SHOP] }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ReportsRoutingModule {}
