import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../../auth.guard';
import { PermissionGuard } from '../../../guards/permission.guard';
import { PERMISSIONS } from '../../../models/access-control.model';

import { VendorsAdminComponent } from './vendors-admin.component';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { VendorFormComponent } from './vendor-form/vendor-form.component';

const routes: Routes = [
  {
    path: '',
    component: VendorsAdminComponent,
    canActivate: [AuthGuard, PermissionGuard],
    data: { anyPermission: [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_ADMIN] },
  },
];

@NgModule({
  declarations: [VendorsAdminComponent, VendorsListComponent, VendorFormComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild(routes),
  ],
})
export class VendorsAdminModule {}
