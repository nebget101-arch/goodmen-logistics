import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InvoicesListComponent } from './invoices-list/invoices-list.component';
import { InvoiceDetailComponent } from './invoice-detail/invoice-detail.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';

const routes: Routes = [
  { path: '', component: InvoicesListComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/invoices' } },
  { path: ':id', component: InvoiceDetailComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/invoices' } }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class InvoicingRoutingModule {}
