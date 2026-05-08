import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { WarehouseReceivingComponent } from './warehouse-receiving.component';
import { QuickAddPanelComponent } from './quick-add-panel.component';
import { ReceivingActivityComponent } from './receiving-activity.component';
import { ReceivingActivityDrawerComponent } from './receiving-activity-drawer.component';
import { InvoiceUploadCardComponent } from './invoice-upload-card.component';
import { InvoiceReviewModalComponent } from './invoice-review-modal.component';

const routes: Routes = [
  {
    path: '',
    component: WarehouseReceivingComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/receiving' }
  }
];

// FN-1549: lazy-loaded feature module for `/receiving` — heaviest single
// route in the app (~210 KB of source across the parent + 5 child components
// for invoice upload/review, quick-add, and receiving activity drawer).
@NgModule({
  declarations: [
    WarehouseReceivingComponent,
    QuickAddPanelComponent,
    ReceivingActivityComponent,
    ReceivingActivityDrawerComponent,
    InvoiceUploadCardComponent,
    InvoiceReviewModalComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class WarehouseReceivingModule {}
