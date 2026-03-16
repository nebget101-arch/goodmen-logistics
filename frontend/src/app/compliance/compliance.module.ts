import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ComplianceRoutingModule } from './compliance-routing.module';
import { IftaQuarterlyComponent } from './ifta-quarterly/ifta-quarterly.component';

@NgModule({
  declarations: [IftaQuarterlyComponent],
  imports: [
    CommonModule,
    FormsModule,
    ComplianceRoutingModule,
  ]
})
export class ComplianceModule {}
