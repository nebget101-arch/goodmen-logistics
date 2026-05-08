import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { AuthGuard } from '../../auth.guard';
import { InternalTrialAdminGuard } from '../../guards/internal-trial-admin.guard';
import { TrialRequestsAdminComponent } from './trial-requests-admin.component';

const routes: Routes = [
  {
    path: '',
    component: TrialRequestsAdminComponent,
    canActivate: [AuthGuard, InternalTrialAdminGuard]
  }
];

// FN-1549: lazy-loaded admin route for trial-request triage
// (`/admin/trial-requests`). Internal-only.
@NgModule({
  declarations: [TrialRequestsAdminComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class TrialRequestsAdminModule {}
