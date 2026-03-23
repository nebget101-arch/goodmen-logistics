import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { ReportsRoutingModule } from './reports-routing.module';
import { ReportsShellComponent } from './pages/reports-shell/reports-shell.component';
import { ReportViewComponent } from './pages/report-view/report-view.component';
import { ReportChartComponent } from './components/report-chart/report-chart.component';
import { ReportTableComponent } from './components/report-table/report-table.component';
import { ReportFiltersComponent } from './components/report-filters/report-filters.component';
import { KpiCardsComponent } from './components/kpi-cards/kpi-cards.component';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';

@NgModule({
  declarations: [
    ReportsShellComponent,
    ReportViewComponent,
    ReportChartComponent,
    ReportTableComponent,
    ReportFiltersComponent,
    KpiCardsComponent,
    ReportsPageComponent
  ],
  imports: [CommonModule, FormsModule, SharedModule, ReportsRoutingModule]
})
export class ReportsModule {}
