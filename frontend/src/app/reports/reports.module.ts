import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReportChartComponent } from './components/report-chart/report-chart.component';
import { ReportTableComponent } from './components/report-table/report-table.component';
import { ReportFiltersComponent } from './components/report-filters/report-filters.component';
import { KpiCardsComponent } from './components/kpi-cards/kpi-cards.component';
import { ReportsPageComponent } from './pages/reports-page/reports-page.component';
import { ReportsRoutingModule } from './reports-routing.module';

@NgModule({
  declarations: [
    ReportChartComponent,
    ReportTableComponent,
    ReportFiltersComponent,
    KpiCardsComponent,
    ReportsPageComponent
  ],
  imports: [CommonModule, FormsModule, ReportsRoutingModule],
  exports: [ReportsPageComponent]
})
export class ReportsModule {}
