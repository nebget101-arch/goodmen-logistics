import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SafetyService } from '../safety.service';

@Component({
  selector: 'app-safety-claims',
  templateUrl: './safety-claims.component.html',
  styleUrls: ['./safety-claims.component.css']
})
export class SafetyClaimsComponent implements OnInit {
  claims: any[] = [];
  total = 0;
  page = 1;
  pageSize = 25;
  loading = true;
  error = '';

  filters: any = { status: '', claim_type: '', overdue_only: false };
  selectedClaim: any = null;
  saving = false;

  readonly STATUSES = ['open', 'submitted', 'under_investigation', 'settled', 'closed', 'denied', 'litigated'];
  readonly CLAIM_TYPES = ['auto_liability', 'cargo', 'general_liability', 'workers_comp', 'property'];

  constructor(private safety: SafetyService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      const claimId = params['claim'];
      if (claimId) {
        this.loadClaim(claimId);
      }
    });
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.safety.getClaims({
      page: this.page,
      pageSize: this.pageSize,
      status: this.filters.status || undefined,
      claim_type: this.filters.claim_type || undefined,
      overdue_only: this.filters.overdue_only || undefined,
    }).subscribe({
      next: (res) => { this.claims = res.data || []; this.total = res.total || 0; this.loading = false; },
      error: () => { this.error = 'Failed to load claims'; this.loading = false; }
    });
  }

  loadClaim(id: string): void {
    this.safety.getClaim(id).subscribe({ next: (claim) => { this.selectedClaim = claim; } });
  }

  applyFilters(): void { this.page = 1; this.load(); }
  clearFilters(): void { this.filters = { status: '', claim_type: '', overdue_only: false }; this.page = 1; this.load(); }

  openClaim(claim: any): void {
    this.selectedClaim = { ...claim };
    // Load latest full claim data
    this.loadClaim(claim.id);
  }

  closeDrawer(): void { this.selectedClaim = null; }

  saveClaim(): void {
    if (!this.selectedClaim) return;
    this.saving = true;
    this.safety.updateClaim(this.selectedClaim.id, this.selectedClaim).subscribe({
      next: (updated) => {
        this.saving = false;
        const idx = this.claims.findIndex(c => c.id === updated.id);
        if (idx > -1) this.claims[idx] = { ...this.claims[idx], ...updated };
        this.selectedClaim = updated;
      },
      error: () => { this.saving = false; alert('Failed to save claim'); }
    });
  }

  prevPage(): void { if (this.page > 1) { this.page--; this.load(); } }
  nextPage(): void { if (this.page * this.pageSize < this.total) { this.page++; this.load(); } }
  get pages(): number { return Math.ceil(this.total / this.pageSize) || 1; }

  statusClass(s: string): string {
    if (s === 'closed' || s === 'settled') return 'badge-closed';
    if (s === 'denied') return 'badge-denied';
    return 'badge-open';
  }

  claimTypeClass(type: string): string {
    return `type-${(type || 'default').replace(/[^a-z0-9]+/gi, '-')}`;
  }

  parseMoney(value: any): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
