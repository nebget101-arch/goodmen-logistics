import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
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
    SharedModule,
    InvoicingRoutingModule
  ]
})
export class InvoicingModule {}
