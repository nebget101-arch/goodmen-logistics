import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettlementsRoutingModule } from './settlements-routing.module';
import { SettlementListComponent } from './settlement-list/settlement-list.component';
import { SettlementWizardComponent } from './settlement-wizard/settlement-wizard.component';
import { SettlementDetailComponent } from './settlement-detail/settlement-detail.component';
import { ScheduledDeductionsComponent } from './scheduled-deductions/scheduled-deductions.component';

@NgModule({
  declarations: [
    SettlementListComponent,
    SettlementWizardComponent,
    SettlementDetailComponent,
    ScheduledDeductionsComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SettlementsRoutingModule
  ]
})
export class SettlementsModule {}
