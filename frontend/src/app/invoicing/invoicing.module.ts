import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvoicingRoutingModule } from './invoicing-routing.module';
import { InvoicesListComponent } from './invoices-list/invoices-list.component';
import { InvoiceDetailComponent } from './invoice-detail/invoice-detail.component';

@NgModule({
  declarations: [
    InvoicesListComponent,
    InvoiceDetailComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    InvoicingRoutingModule
  ]
})
export class InvoicingModule {}
