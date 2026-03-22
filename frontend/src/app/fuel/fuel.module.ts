import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FuelRoutingModule } from './fuel-routing.module';

import { FuelShellComponent } from './fuel-shell/fuel-shell.component';
import { FuelOverviewComponent } from './fuel-overview/fuel-overview.component';
import { FuelTransactionsComponent } from './fuel-transactions/fuel-transactions.component';
import { FuelImportWizardComponent } from './fuel-import-wizard/fuel-import-wizard.component';
import { FuelImportHistoryComponent } from './fuel-import-history/fuel-import-history.component';
import { FuelCardsComponent } from './fuel-cards/fuel-cards.component';
import { FuelExceptionsComponent } from './fuel-exceptions/fuel-exceptions.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [
    FuelShellComponent,
    FuelOverviewComponent,
    FuelTransactionsComponent,
    FuelImportWizardComponent,
    FuelImportHistoryComponent,
    FuelCardsComponent,
    FuelExceptionsComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    FuelRoutingModule,
    SharedModule,
  ]
})
export class FuelModule {}
