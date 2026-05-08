// FN-1594 — Lazy-loaded module for /loads/import.

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { PermissionGuard } from '../../guards/permission.guard';
import { PERMISSIONS } from '../../models/access-control.model';
import { SharedModule } from '../../shared/shared.module';

import { LoadsImportWizardComponent } from './loads-import-wizard.component';
import { LoadsImportUploadStepComponent } from './steps/upload-step.component';
import { LoadsImportAiAnalysisStepComponent } from './steps/ai-analysis-step.component';
import { LoadsImportMappingStepComponent } from './steps/mapping-step.component';
import { LoadsImportValidateStepComponent } from './steps/validate-step.component';
import { LoadsImportCommitStepComponent } from './steps/commit-step.component';
import { LoadsImportResultStepComponent } from './steps/result-step.component';
import { LoadsImportDuplicateReviewModalComponent } from './duplicate-review-modal/duplicate-review-modal.component';

const routes: Routes = [
  {
    path: '',
    component: LoadsImportWizardComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/loads',
      anyPermission: [PERMISSIONS.LOADS_CREATE, PERMISSIONS.LOADS_EDIT],
    },
  },
];

@NgModule({
  declarations: [
    LoadsImportWizardComponent,
    LoadsImportUploadStepComponent,
    LoadsImportAiAnalysisStepComponent,
    LoadsImportMappingStepComponent,
    LoadsImportValidateStepComponent,
    LoadsImportCommitStepComponent,
    LoadsImportResultStepComponent,
    LoadsImportDuplicateReviewModalComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild(routes),
  ],
})
export class LoadsImportModule {}
