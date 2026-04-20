import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { SharedModule } from '../../shared/shared.module';
import { LoadWizardModule } from './load-wizard/load-wizard.module';

import { LoadsDashboardComponent } from './loads-dashboard.component';
import { BulkExtractionGridComponent } from './bulk-extraction-grid/bulk-extraction-grid.component';
import { StatusPillComponent } from '../shared/status-pill/status-pill.component';
import { AttachmentChipComponent } from '../shared/attachment-chip/attachment-chip.component';
import { InlineDateFilterComponent } from '../shared/inline-date-filter/inline-date-filter.component';
import { StepBasicsComponent } from './load-wizard/step-basics/step-basics.component';
import { StepStopsComponent } from './load-wizard/step-stops/step-stops.component';
import { WizardStepDriverComponent } from './load-wizard/step-driver/step-driver.component';
import { StepAttachmentsComponent } from './load-wizard/step-attachments/step-attachments.component';
import { LoadsHeroCtaComponent } from './loads-hero-cta/loads-hero-cta.component';
import { LoadTemplatesComponent } from './load-templates/load-templates.component';

const routes: Routes = [
  {
    path: '',
    component: LoadsDashboardComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/loads' }
  },
  {
    path: 'templates',
    component: LoadTemplatesComponent,
    canActivate: [AuthGuard, PlanGuard],
    data: { planPath: '/loads' }
  }
];

/**
 * LoadsDashboardModule — lazy-loaded feature module for `/loads`
 * (FN-770). Isolates Leaflet (the loads-dashboard's map dependency)
 * out of the initial bundle. Carries the small shared chips
 * (status-pill, attachment-chip, inline-date-filter, date-picker)
 * and wizard step components that are only consumed here.
 */
@NgModule({
  declarations: [
    LoadsDashboardComponent,
    BulkExtractionGridComponent,
    StatusPillComponent,
    AttachmentChipComponent,
    InlineDateFilterComponent,
    StepBasicsComponent,
    StepStopsComponent,
    WizardStepDriverComponent,
    StepAttachmentsComponent,
    LoadsHeroCtaComponent,
    LoadTemplatesComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    DragDropModule,
    ScrollingModule,
    SharedModule,
    LoadWizardModule,
    RouterModule.forChild(routes)
  ]
})
export class LoadsDashboardModule {}
