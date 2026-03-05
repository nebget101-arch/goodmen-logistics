import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-audit',
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.css']
})
export class AuditComponent implements OnInit {
  auditTrail: any[] = [];
  complianceSummary: any = null;
  loading = true;
  selectedCategory = 'dqf';

  constructor(private apiService: ApiService) { }

  ngOnInit(): void {
    this.loadAuditData();
  }

  loadAuditData(): void {
    this.apiService.getAuditTrail().subscribe({
      next: (data) => {
        this.auditTrail = data;
      },
      error: (error) => {
        console.error('Error loading audit trail:', error);
      }
    });

    this.apiService.getComplianceSummary().subscribe({
      next: (data) => {
        this.complianceSummary = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading compliance summary:', error);
        this.loading = false;
      }
    });
  }

  exportData(): void {
    this.apiService.exportData(this.selectedCategory).subscribe({
      next: (data) => {
        console.log('Export data:', data);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.selectedCategory}-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (error) => {
        console.error('Error exporting data:', error);
      }
    });
  }
}
