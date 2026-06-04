import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { SharedModule } from '../../shared/shared.module';
import { GeofencesComponent } from './geofences.component';

const routes: Routes = [
  {
    path: '',
    component: GeofencesComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/geofences' },
  },
];

/**
 * GeofencesModule — lazy-loaded feature module for the `/geofences` route
 * (FN-1666). Isolates the `leaflet-draw` dependency out of the initial bundle.
 * Imports SharedModule for `app-ai-select`.
 */
@NgModule({
  declarations: [GeofencesComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes),
  ],
})
export class GeofencesModule {}
