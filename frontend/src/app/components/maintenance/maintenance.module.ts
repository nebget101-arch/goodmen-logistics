import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { PermissionGuard } from '../../guards/permission.guard';
import { PERMISSIONS } from '../../models/access-control.model';
import { MaintenanceComponent } from './maintenance.component';

const routes: Routes = [
  {
    path: '',
    component: MaintenanceComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/maintenance',
      anyPermission: [PERMISSIONS.MAINTENANCE_VIEW, PERMISSIONS.WORK_ORDERS_VIEW]
    }
  }
];

/**
 * MaintenanceModule — lazy-loaded feature module for the
 * `/maintenance` work-order list page (FN-770). The FN-720 redesign
 * bulked up this view with stats cards, filters, and bulk actions,
 * so moving it out of the initial bundle gives meaningful savings.
 */
@NgModule({
  declarations: [MaintenanceComponent],
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule.forChild(routes)]
})
export class MaintenanceModule {}
