import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { AuthGuard } from '../../auth.guard';
import { PlanGuard } from '../../guards/plan.guard';
import { PermissionGuard } from '../../guards/permission.guard';
import { PERMISSIONS } from '../../models/access-control.model';
import { SharedModule } from '../../shared/shared.module';

import { WorkOrderComponent } from './work-order.component';
import { WoStatusBarComponent } from './status-bar/status-bar.component';
import { WoBasicsTabComponent } from './tabs/basics-tab/basics-tab.component';
import { WoServiceDetailsTabComponent } from './tabs/service-details-tab/service-details-tab.component';
import { WoWorkTabComponent } from './tabs/work-tab/work-tab.component';
import { WoFinancialsTabComponent } from './tabs/financials-tab/financials-tab.component';
import { WoNotesTabComponent } from './tabs/notes-tab/notes-tab.component';
import { WoWorkflowButtonsComponent } from './workflow-buttons/workflow-buttons.component';
import { WoStatusTimelineComponent } from './workflow-buttons/status-timeline.component';

const routes: Routes = [
  {
    path: '',
    component: WorkOrderComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/work-order',
      anyPermission: [PERMISSIONS.WORK_ORDERS_VIEW, PERMISSIONS.WORK_ORDERS_CREATE, PERMISSIONS.WORK_ORDERS_EDIT]
    }
  },
  {
    path: ':id',
    component: WorkOrderComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: {
      planPath: '/work-order',
      anyPermission: [PERMISSIONS.WORK_ORDERS_VIEW, PERMISSIONS.WORK_ORDERS_EDIT]
    }
  }
];

/**
 * WorkOrderModule — lazy-loaded feature module for `/work-order` and
 * `/work-order/:id` (FN-770). Bundles the work-order shell plus all
 * 6 tab components and workflow-buttons. This is large after the
 * FN-714 tabs refactor, so moving it out of the initial bundle is
 * the biggest single win.
 */
@NgModule({
  declarations: [
    WorkOrderComponent,
    WoStatusBarComponent,
    WoBasicsTabComponent,
    WoServiceDetailsTabComponent,
    WoWorkTabComponent,
    WoFinancialsTabComponent,
    WoNotesTabComponent,
    WoWorkflowButtonsComponent,
    WoStatusTimelineComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class WorkOrderModule {}
