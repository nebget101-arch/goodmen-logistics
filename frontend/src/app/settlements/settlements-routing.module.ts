import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SettlementListComponent } from './settlement-list/settlement-list.component';
import { SettlementWizardComponent } from './settlement-wizard/settlement-wizard.component';
import { SettlementDetailComponent } from './settlement-detail/settlement-detail.component';
import { ScheduledDeductionsComponent } from './scheduled-deductions/scheduled-deductions.component';
import { EquipmentOwnersComponent } from './equipment-owners/equipment-owners.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { PERMISSIONS } from '../models/access-control.model';

const routes: Routes = [
  {
    path: '',
    component: SettlementListComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements', anyPermission: [PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_CREATE, PERMISSIONS.SETTLEMENTS_EDIT] }
  },
  {
    path: 'scheduled-deductions',
    component: ScheduledDeductionsComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements/scheduled-deductions', anyPermission: [PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_EDIT] }
  },
  {
    path: 'equipment-owners',
    component: EquipmentOwnersComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements/equipment-owners', anyPermission: [PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_EDIT] }
  },
  {
    path: 'new',
    component: SettlementWizardComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements', anyPermission: [PERMISSIONS.SETTLEMENTS_CREATE, PERMISSIONS.SETTLEMENTS_EDIT] }
  },
  {
    path: ':id',
    component: SettlementDetailComponent,
    canActivate: [AuthGuard, PlanGuard, PermissionGuard],
    data: { planPath: '/settlements', anyPermission: [PERMISSIONS.SETTLEMENTS_VIEW, PERMISSIONS.SETTLEMENTS_EDIT] }
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SettlementsRoutingModule {}
