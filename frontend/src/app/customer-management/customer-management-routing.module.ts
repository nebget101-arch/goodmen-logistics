import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomersListComponent } from './customers-list/customers-list.component';
import { CustomerFormComponent } from './customer-form/customer-form.component';
import { CustomerDetailComponent } from './customer-detail/customer-detail.component';
import { CustomerBulkUploadComponent } from '../components/customer-bulk-upload/customer-bulk-upload.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

const routes: Routes = [
  {
    path: '',
    component: CustomersListComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/customers', anyPermission: [PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_EDIT] }
  },
  {
    path: 'bulk-upload',
    component: CustomerBulkUploadComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/customers', anyPermission: [PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT] }
  },
  {
    path: 'new',
    component: CustomerFormComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/customers', anyPermission: [PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_EDIT] }
  },
  {
    path: ':id/edit',
    component: CustomerFormComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/customers', anyPermission: [PERMISSIONS.CUSTOMERS_EDIT, PERMISSIONS.CUSTOMERS_CREATE] }
  },
  {
    path: ':id',
    component: CustomerDetailComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/customers', anyPermission: [PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_EDIT] }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CustomerManagementRoutingModule {}
