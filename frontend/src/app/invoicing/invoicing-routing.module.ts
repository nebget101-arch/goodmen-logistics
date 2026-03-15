import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InvoicesListComponent } from './invoices-list/invoices-list.component';
import { InvoiceDetailComponent } from './invoice-detail/invoice-detail.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

const routes: Routes = [
  {
    path: '',
    component: InvoicesListComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/invoices', anyPermission: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT] }
  },
  {
    path: ':id',
    component: InvoiceDetailComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/invoices', anyPermission: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_EDIT] }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class InvoicingRoutingModule {}
