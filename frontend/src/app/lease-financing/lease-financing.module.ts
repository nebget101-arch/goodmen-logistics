import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeaseFinancingRoutingModule } from './lease-financing-routing.module';
import { LeaseAgreementsListComponent } from './pages/lease-agreements-list/lease-agreements-list.component';
import { LeaseAgreementDetailComponent } from './pages/lease-agreement-detail/lease-agreement-detail.component';
import { LeaseAgreementFormComponent } from './pages/lease-agreement-form/lease-agreement-form.component';
import { LeaseFinancingDashboardComponent } from './pages/lease-financing-dashboard/lease-financing-dashboard.component';
import { LeaseUpgradeRequiredComponent } from './pages/lease-upgrade-required/lease-upgrade-required.component';
import { DriverLeaseViewComponent } from './pages/driver-lease-view/driver-lease-view.component';

@NgModule({
  declarations: [
    LeaseAgreementsListComponent,
    LeaseAgreementDetailComponent,
    LeaseAgreementFormComponent,
    LeaseFinancingDashboardComponent,
    LeaseUpgradeRequiredComponent,
    DriverLeaseViewComponent,
  ],
  imports: [CommonModule, FormsModule, LeaseFinancingRoutingModule]
})
export class LeaseFinancingModule {}
