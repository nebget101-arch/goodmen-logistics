import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InvoicesListComponent } from './invoices-list/invoices-list.component';
import { InvoiceDetailComponent } from './invoice-detail/invoice-detail.component';
import { AuthGuard } from '../auth.guard';

const routes: Routes = [
  { path: '', component: InvoicesListComponent, canActivate: [AuthGuard] },
  { path: ':id', component: InvoiceDetailComponent, canActivate: [AuthGuard] }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class InvoicingRoutingModule {}
