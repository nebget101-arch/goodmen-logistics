import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { SharedModule } from '../../shared/shared.module';
import { TrackingMapComponent } from './tracking-map.component';

const routes: Routes = [
  {
    path: '',
    component: TrackingMapComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/tracking' },
  },
];

/**
 * TrackingMapModule — lazy-loaded feature module for the `/tracking` live map
 * (FN-1671; re-engined to MapLibre GL in FN-1720). Isolates the `maplibre-gl`
 * WebGL engine out of the initial bundle (same pattern as GeofencesModule).
 * Imports SharedModule for `app-ai-select` and FormsModule for the `ngModel`
 * filter bindings.
 */
@NgModule({
  declarations: [TrackingMapComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild(routes),
  ],
})
export class TrackingMapModule {}
