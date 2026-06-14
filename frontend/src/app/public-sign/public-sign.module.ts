import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PublicSignRoutingModule } from './public-sign-routing.module';

import { SignerPageComponent } from './signer-page/signer-page.component';
import { SignatureCaptureComponent } from './signature-capture/signature-capture.component';

/**
 * FN-1798 — public signing feature. Lazy-loaded at `/sign/:token` for the
 * unauthenticated signer flow. Deliberately does NOT import SharedModule (which
 * pulls in the authed app shell / guards); the signer page is self-contained.
 */
@NgModule({
  declarations: [
    SignerPageComponent,
    SignatureCaptureComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    PublicSignRoutingModule,
  ],
})
export class PublicSignModule {}
