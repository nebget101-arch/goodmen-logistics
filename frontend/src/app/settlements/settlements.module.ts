import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { SettlementsRoutingModule } from './settlements-routing.module';
import { SettlementListComponent } from './settlement-list/settlement-list.component';
import { SettlementWizardComponent } from './settlement-wizard/settlement-wizard.component';
import { SettlementDetailComponent } from './settlement-detail/settlement-detail.component';
import { ScheduledDeductionsComponent } from './scheduled-deductions/scheduled-deductions.component';
import { EquipmentOwnersComponent } from './equipment-owners/equipment-owners.component';
import { BalanceTransferQueueComponent } from './balance-transfer-queue/balance-transfer-queue.component';

@NgModule({
  declarations: [
    SettlementListComponent,
    SettlementWizardComponent,
    SettlementDetailComponent,
    ScheduledDeductionsComponent,
    EquipmentOwnersComponent,
    BalanceTransferQueueComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    SettlementsRoutingModule
  ]
})
export class SettlementsModule {}
