import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { PermissionGuard } from '../../guards/permission.guard';
import { PERMISSIONS } from '../../models/access-control.model';
import { SharedModule } from '../../shared/shared.module';

import { VehicleTrackingComponent } from './vehicle-tracking.component';

const routes: Routes = [
  {
    path: '',
    component: VehicleTrackingComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/vehicle-tracking',
      anyPermission: [PERMISSIONS.VEHICLES_VIEW]
    }
  }
];

/**
 * VehicleTrackingModule — lazy-loaded feature module for `/vehicle-tracking`.
 * Isolates Leaflet (the tracking map's dependency) out of the initial bundle,
 * mirroring the FN-770 pattern used for LoadsDashboardModule.
 */
@NgModule({
  declarations: [VehicleTrackingComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class VehicleTrackingModule {}
