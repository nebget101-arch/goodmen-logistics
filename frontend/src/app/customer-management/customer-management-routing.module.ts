import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomersListComponent } from './customers-list/customers-list.component';
import { CustomerFormComponent } from './customer-form/customer-form.component';
import { CustomerDetailComponent } from './customer-detail/customer-detail.component';
import { CustomerBulkUploadComponent } from '../components/customer-bulk-upload/customer-bulk-upload.component';
import { AuthGuard } from '../auth.guard';

const routes: Routes = [
  { path: '', component: CustomersListComponent, canActivate: [AuthGuard] },
  { path: 'bulk-upload', component: CustomerBulkUploadComponent, canActivate: [AuthGuard] },
  { path: 'new', component: CustomerFormComponent, canActivate: [AuthGuard] },
  { path: ':id/edit', component: CustomerFormComponent, canActivate: [AuthGuard] },
  { path: ':id', component: CustomerDetailComponent, canActivate: [AuthGuard] }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CustomerManagementRoutingModule {}
