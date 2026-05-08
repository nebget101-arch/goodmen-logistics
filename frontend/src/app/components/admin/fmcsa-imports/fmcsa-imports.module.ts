import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../../shared/shared.module';
import { AuthGuard } from '../../../auth.guard';
import { InternalTenantGuard } from '../../../guards/internal-tenant.guard';
import { FmcsaImportsAdminComponent } from './fmcsa-imports.component';

const routes: Routes = [
  {
    path: '',
    component: FmcsaImportsAdminComponent,
    canActivate: [AuthGuard, InternalTenantGuard]
  }
];

// FN-1549: lazy-loaded admin route for FMCSA bulk-import tooling
// (`/admin/fmcsa-imports`). Internal-only, rarely visited from main flows.
@NgModule({
  declarations: [FmcsaImportsAdminComponent],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class FmcsaImportsAdminModule {}
