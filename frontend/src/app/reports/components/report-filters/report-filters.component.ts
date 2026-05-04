import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { ReportFilters, ReportKey } from '../../reports.models';
import { ReportsService } from '../../services/reports.service';

@Component({
  selector: 'app-report-filters',
  templateUrl: './report-filters.component.html',
  styleUrls: ['./report-filters.component.css']
})
export class ReportFiltersComponent implements OnChanges {
  @Input() filters: ReportFilters = {};
  @Input() locations: { id: string; name: string }[] = [];
  @Input() reportKey?: ReportKey;
  @Output() apply = new EventEmitter<ReportFilters>();
  @Output() clear = new EventEmitter<void>();

  localFilters: ReportFilters = {};

  nlQuery = '';
  nlLoading = false;
  nlError: string | null = null;
  unmatchedTokens: string[] = [];

  constructor(private reports: ReportsService) {}

  ngOnChanges(): void {
    this.localFilters = { ...this.filters };
  }

  onApply(): void {
    this.apply.emit({ ...this.localFilters });
  }

  onClear(): void {
    this.localFilters = {};
    this.nlQuery = '';
    this.nlError = null;
    this.unmatchedTokens = [];
    this.clear.emit();
  }

  onNlSubmit(): void {
    const query = (this.nlQuery || '').trim();
    if (!query || !this.reportKey || this.nlLoading) return;
    this.nlLoading = true;
    this.nlError = null;
    this.unmatchedTokens = [];
    this.reports.parseNlQuery(this.reportKey, query, { ...this.localFilters }).subscribe({
      next: (res) => {
        this.localFilters = { ...this.localFilters, ...(res?.filters || {}) };
        this.unmatchedTokens = Array.isArray(res?.unmatchedTokens) ? res.unmatchedTokens : [];
        this.nlLoading = false;
        this.apply.emit({ ...this.localFilters });
      },
      error: (err) => {
        this.nlLoading = false;
        this.nlError = (err?.error?.message as string) || 'Could not parse query. Try simpler wording.';
      }
    });
  }
}
