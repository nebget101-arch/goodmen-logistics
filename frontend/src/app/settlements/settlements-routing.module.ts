import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SettlementListComponent } from './settlement-list/settlement-list.component';
import { SettlementWizardComponent } from './settlement-wizard/settlement-wizard.component';
import { SettlementDetailComponent } from './settlement-detail/settlement-detail.component';
import { ScheduledDeductionsComponent } from './scheduled-deductions/scheduled-deductions.component';
import { AuthGuard } from '../auth.guard';

const routes: Routes = [
  { path: '', component: SettlementListComponent, canActivate: [AuthGuard] },
  { path: 'scheduled-deductions', component: ScheduledDeductionsComponent, canActivate: [AuthGuard] },
  { path: 'new', component: SettlementWizardComponent, canActivate: [AuthGuard] },
  { path: ':id', component: SettlementDetailComponent, canActivate: [AuthGuard] }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class SettlementsRoutingModule {}
