import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';

import { AgreementUploadComponent } from './agreement-upload/agreement-upload.component';
import { AgreementReviewComponent } from './agreement-review/agreement-review.component';
import { AgreementPlacementComponent } from './agreement-placement/agreement-placement.component';

// Note: an `agreements:*` permission set is not yet defined in the frontend
// access-control model (FN-1792 adds the backend grants). Gate on AuthGuard for
// now; add PermissionGuard + PERMISSIONS.AGREEMENTS_* once those land.
const routes: Routes = [
  { path: '', component: AgreementUploadComponent, canActivate: [AuthGuard] },
  { path: ':id/review', component: AgreementReviewComponent, canActivate: [AuthGuard] },
  // FN-1807 — visual bbox field-placement editor.
  { path: ':id/placement', component: AgreementPlacementComponent, canActivate: [AuthGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AgreementsRoutingModule {}
