import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SettlementListComponent } from './settlement-list/settlement-list.component';
import { SettlementWizardComponent } from './settlement-wizard/settlement-wizard.component';
import { SettlementDetailComponent } from './settlement-detail/settlement-detail.component';
import { ScheduledDeductionsComponent } from './scheduled-deductions/scheduled-deductions.component';
import { EquipmentOwnersComponent } from './equipment-owners/equipment-owners.component';
import { AuthGuard } from '../auth.guard';
import { PlanGuard } from '../guards/plan.guard';

const routes: Routes = [
  { path: '', component: SettlementListComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/settlements' } },
  { path: 'scheduled-deductions', component: ScheduledDeductionsComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/settlements/scheduled-deductions' } },
  { path: 'equipment-owners', component: EquipmentOwnersComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/settlements/equipment-owners' } },
  { path: 'new', component: SettlementWizardComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/settlements' } },
  { path: ':id', component: SettlementDetailComponent, canActivate: [AuthGuard, PlanGuard], data: { planPath: '/settlements' } }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SettlementsRoutingModule {}
