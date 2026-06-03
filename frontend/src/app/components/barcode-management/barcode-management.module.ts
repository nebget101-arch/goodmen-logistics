import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { BarcodeManagementComponent } from './barcode-management.component';

const routes: Routes = [
  {
    path: '',
    component: BarcodeManagementComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/barcodes' }
  }
];

/**
 * BarcodeManagementModule — lazy-loaded feature module for the
 * `/barcodes` route. Isolates the `qrcode` CommonJS dependency out of
 * the initial bundle (FN-770).
 */
@NgModule({
  declarations: [BarcodeManagementComponent],
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule.forChild(routes)]
})
export class BarcodeManagementModule {}
