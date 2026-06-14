import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AgreementsRoutingModule } from './agreements-routing.module';
import { SharedModule } from '../shared/shared.module';

import { AgreementUploadComponent } from './agreement-upload/agreement-upload.component';
import { AgreementReviewComponent } from './agreement-review/agreement-review.component';
import { AgreementSendComponent } from './agreement-send/agreement-send.component';

@NgModule({
  declarations: [
    AgreementUploadComponent,
    AgreementReviewComponent,
    AgreementSendComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    AgreementsRoutingModule,
  ],
})
export class AgreementsModule {}
