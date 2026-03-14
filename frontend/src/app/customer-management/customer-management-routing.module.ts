import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomersListComponent } from './customers-list/customers-list.component';
import { CustomerFormComponent } from './customer-form/customer-form.component';
import { CustomerDetailComponent } from './customer-detail/customer-detail.component';
import { CustomerBulkUploadComponent } from '../components/customer-bulk-upload/customer-bulk-upload.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';

const routes: Routes = [
  { path: '', component: CustomersListComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/customers' } },
  { path: 'bulk-upload', component: CustomerBulkUploadComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/customers' } },
  { path: 'new', component: CustomerFormComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/customers' } },
  { path: ':id/edit', component: CustomerFormComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/customers' } },
  { path: ':id', component: CustomerDetailComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/customers' } }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CustomerManagementRoutingModule {}
