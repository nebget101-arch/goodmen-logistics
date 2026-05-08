import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '../../shared/shared.module';
import { OnboardingPacketComponent } from './onboarding-packet.component';
import { ConsentFormComponent } from './consent-form/consent-form.component';
import { EmployerHistoryTieredComponent } from './employer-history-tiered/employer-history-tiered.component';
import { DisqualificationHistoryComponent } from './disqualification-history/disqualification-history.component';

const routes: Routes = [
  { path: '', component: OnboardingPacketComponent }
];

// FN-1549: lazy-loaded feature module for the public driver onboarding packet
// (`/onboard/:packetId`) — keeps the packet form and its three tiered child
// forms out of the initial bundle.
@NgModule({
  declarations: [
    OnboardingPacketComponent,
    ConsentFormComponent,
    EmployerHistoryTieredComponent,
    DisqualificationHistoryComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ]
})
export class OnboardingPacketModule {}
