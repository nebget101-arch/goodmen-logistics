import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { EmploymentApplicationComponent } from './employment-application.component';

const routes: Routes = [
  { path: '', component: EmploymentApplicationComponent }
];

// FN-1549: lazy-loaded feature module for the public employment-application
// route — large standalone form, never visited from authenticated flows.
@NgModule({
  declarations: [EmploymentApplicationComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class EmploymentApplicationModule {}
