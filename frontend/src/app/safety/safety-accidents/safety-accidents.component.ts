import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { SafetyService } from '../safety.service';

@Component({
  selector: 'app-safety-accidents',
  templateUrl: './safety-accidents.component.html',
  styleUrls: ['./safety-accidents.component.css']
})
export class SafetyAccidentsComponent implements OnInit {
  incidents: any[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = true;
  error = '';

  // Form / drawer state
  showForm = false;
  saving = false;
  formError = '';
  form: any = this.blankForm();

  // Filter state
  filters: any = { status: '', severity: '', incident_type: '', operating_entity_id: '', search: '' };

  readonly STATUSES = ['open', 'under_review', 'pending_close', 'closed'];
  readonly SEVERITIES = ['critical', 'major', 'minor', 'near_miss'];
  readonly TYPES = ['collision', 'cargo_damage', 'injury', 'property_damage', 'spill', 'near_miss', 'other'];
  readonly PREVENTABILITIES = ['preventable', 'non_preventable', 'undetermined'];

  constructor(private safety: SafetyService, private router: Router, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      if (params['new'] === '1') { this.openForm(); }
      this.filters = {
        ...this.filters,
        status: params['status'] || this.filters.status || '',
        operating_entity_id: params['operating_entity_id'] || this.filters.operating_entity_id || ''
      };
      this.page = 1;
      this.load();
    });
  }

  load(): void {
    this.loading = true;
    this.error = '';
    const params: any = { page: this.page, pageSize: this.pageSize };
    Object.entries(this.filters).forEach(([k, v]) => { if (v) (params as any)[k] = v; });
    this.safety.getIncidents(params).subscribe({
      next: (res) => { this.incidents = res.data; this.total = res.total; this.loading = false; },
      error: () => { this.error = 'Failed to load incidents'; this.loading = false; }
    });
  }

  applyFilters(): void { this.page = 1; this.load(); }
  clearFilters(): void { this.filters = { status: '', severity: '', incident_type: '', operating_entity_id: '', search: '' }; this.page = 1; this.load(); }

  prevPage(): void { if (this.page > 1) { this.page--; this.load(); } }
  nextPage(): void { if (this.page * this.pageSize < this.total) { this.page++; this.load(); } }

  openForm(): void { this.form = this.blankForm(); this.showForm = true; this.formError = ''; }
  closeForm(): void { this.showForm = false; }

  blankForm(): any {
    return {
      incident_type: 'collision',
      severity: 'minor',
      preventability: 'undetermined',
      dot_recordable: false,
      hazmat_involved: false,
      litigation_risk: false,
      incident_date: new Date().toISOString().slice(0, 16),
      location_city: '', location_state: '', location_address: '',
      narrative: '', status: 'open',
    };
  }

  saveIncident(): void {
    this.saving = true;
    this.formError = '';
    this.safety.createIncident(this.form).subscribe({
      next: (row) => {
        this.saving = false;
        this.showForm = false;
        this.router.navigate(['/safety/accidents', row.id]);
      },
      error: (err) => {
        this.saving = false;
        this.formError = err.error?.error || 'Failed to create incident';
      }
    });
  }

  openDetail(id: string): void {
    this.router.navigate(['/safety/accidents', id]);
  }

  statusClass(s: string): string {
    return s === 'closed' ? 'badge-closed' : s === 'open' ? 'badge-open' : 'badge-review';
  }

  severityClass(s: string): string {
    return s === 'critical' ? 'sev-critical' : s === 'major' ? 'sev-major' : s === 'minor' ? 'sev-minor' : 'sev-near-miss';
  }

  get pages(): number { return Math.ceil(this.total / this.pageSize) || 1; }
}
