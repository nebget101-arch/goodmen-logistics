import { Component, OnInit } from '@angular/core';
import { SafetyService } from '../safety.service';

@Component({
  selector: 'app-safety-reports',
  templateUrl: './safety-reports.component.html',
  styleUrls: ['./safety-reports.component.css']
})
export class SafetyReportsComponent implements OnInit {
  loading = true;
  error = '';
  reports: any = null;

  filters = {
    dateFrom: '',
    dateTo: ''
  };

  constructor(private safety: SafetyService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.safety.getReports({
      dateFrom: this.filters.dateFrom || undefined,
      dateTo: this.filters.dateTo || undefined,
    }).subscribe({
      next: (data) => { this.reports = data; this.loading = false; },
      error: () => { this.error = 'Failed to load reports'; this.loading = false; }
    });
  }

  clearFilters(): void {
    this.filters = { dateFrom: '', dateTo: '' };
    this.load();
  }

  toCsv(rows: any[], columns: { key: string; label: string }[]): string {
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = columns.map(c => esc(c.label)).join(',');
    const body = rows.map(r => columns.map(c => esc(r[c.key])).join(',')).join('\n');
    return `${header}\n${body}`;
  }

  downloadCsv(filename: string, rows: any[], columns: { key: string; label: string }[]): void {
    const csv = this.toCsv(rows, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  exportTopCostCsv(): void {
    this.downloadCsv('top-cost-incidents.csv', this.reports?.topCostIncidents || [], [
      { key: 'incident_number', label: 'Incident Number' },
      { key: 'incident_date', label: 'Incident Date' },
      { key: 'incident_type', label: 'Incident Type' },
      { key: 'estimated_loss_amount', label: 'Estimated Loss' },
    ]);
  }

  exportClaimAgingCsv(): void {
    this.downloadCsv('claim-aging.csv', this.reports?.claimAging || [], [
      { key: 'internal_claim_number', label: 'Claim Number' },
      { key: 'status', label: 'Status' },
      { key: 'claim_type', label: 'Claim Type' },
      { key: 'opened_date', label: 'Opened Date' },
      { key: 'insurance_carrier', label: 'Carrier' },
    ]);
  }
}
