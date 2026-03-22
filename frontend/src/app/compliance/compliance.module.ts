import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';

import { ComplianceRoutingModule } from './compliance-routing.module';
import { IftaQuarterlyComponent } from './ifta-quarterly/ifta-quarterly.component';

@NgModule({
  declarations: [IftaQuarterlyComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    ComplianceRoutingModule,
  ]
})
export class ComplianceModule {}
