import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { SafetyRoutingModule } from './safety-routing.module';

import { SafetyShellComponent } from './safety-shell/safety-shell.component';
import { SafetyOverviewComponent } from './safety-overview/safety-overview.component';
import { SafetyAccidentsComponent } from './safety-accidents/safety-accidents.component';
import { SafetyAccidentDetailComponent } from './safety-accident-detail/safety-accident-detail.component';
import { SafetyClaimsComponent } from './safety-claims/safety-claims.component';
import { SafetyTasksComponent } from './safety-tasks/safety-tasks.component';
import { SafetyReportsComponent } from './safety-reports/safety-reports.component';
import { ComplianceDashboardComponent } from './compliance-dashboard/compliance-dashboard.component';
import { FmcsaDashboardComponent } from './fmcsa-dashboard/fmcsa-dashboard.component';
import { FmcsaCarriersComponent } from './fmcsa-carriers/fmcsa-carriers.component';
import { FmcsaCarrierDetailComponent } from './fmcsa-carrier-detail/fmcsa-carrier-detail.component';
import { RiskDashboardComponent } from './risk-dashboard/risk-dashboard.component';
import { DriverRiskTimelineComponent } from './driver-risk-timeline/driver-risk-timeline.component';

@NgModule({
  declarations: [
    SafetyShellComponent,
    SafetyOverviewComponent,
    SafetyAccidentsComponent,
    SafetyAccidentDetailComponent,
    SafetyClaimsComponent,
    SafetyTasksComponent,
    SafetyReportsComponent,
    ComplianceDashboardComponent,
    FmcsaDashboardComponent,
    FmcsaCarriersComponent,
    FmcsaCarrierDetailComponent,
    RiskDashboardComponent,
    DriverRiskTimelineComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    SafetyRoutingModule,
  ]
})
export class SafetyModule {}
