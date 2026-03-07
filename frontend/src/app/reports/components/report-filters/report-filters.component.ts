import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { ReportFilters } from '../../reports.models';

@Component({
  selector: 'app-report-filters',
  templateUrl: './report-filters.component.html',
  styleUrls: ['./report-filters.component.css']
})
export class ReportFiltersComponent implements OnChanges {
  @Input() filters: ReportFilters = {};
  @Input() locations: { id: string; name: string }[] = [];
  @Output() apply = new EventEmitter<ReportFilters>();
  @Output() clear = new EventEmitter<void>();

  localFilters: ReportFilters = {};

  ngOnChanges(): void {
    this.localFilters = { ...this.filters };
  }

  onApply(): void {
    this.apply.emit({ ...this.localFilters });
  }

  onClear(): void {
    this.localFilters = {};
    this.clear.emit();
  }
}
