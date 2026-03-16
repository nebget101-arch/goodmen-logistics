import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../auth.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';
import { IftaQuarterlyComponent } from './ifta-quarterly/ifta-quarterly.component';

const routes: Routes = [
  {
    path: '',
    component: IftaQuarterlyComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: {
      anyPermission: [
        PERMISSIONS.IFTA_VIEW,
        PERMISSIONS.IFTA_EDIT,
        PERMISSIONS.IFTA_IMPORT,
        PERMISSIONS.IFTA_RUN_AI_REVIEW,
        PERMISSIONS.IFTA_FINALIZE,
        PERMISSIONS.IFTA_EXPORT,
      ]
    }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ComplianceRoutingModule {}
