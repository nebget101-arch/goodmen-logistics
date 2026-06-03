import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { LoadWizardComponent } from './load-wizard.component';

/**
 * LoadWizardModule — feature module for the 4-step load creation wizard.
 *
 * Import this module in AppModule (or any host module) to make
 * <app-load-wizard> available.
 */
@NgModule({
  declarations: [LoadWizardComponent],
  imports: [CommonModule, FormsModule],
  exports: [LoadWizardComponent],
})
export class LoadWizardModule {}
