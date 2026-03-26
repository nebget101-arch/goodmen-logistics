import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { FmcsaSafetyService, MonitoredCarrier } from '../fmcsa-safety.service';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';

@Component({
  selector: 'app-fmcsa-carriers',
  templateUrl: './fmcsa-carriers.component.html',
  styleUrls: ['./fmcsa-carriers.component.css'],
  changeDetection: ChangeDetectionStrategy.Default,
})
export class FmcsaCarriersComponent implements OnInit {
  carriers: MonitoredCarrier[] = [];
  loading = true;
  error = '';

  showAddForm = false;
  lookupDotNumber = '';
  lookupResult: {
    found: boolean;
    dotNumber?: string;
    legalName?: string;
    dbaName?: string;
    mcNumber?: string | null;
    status?: string;
    safetyRating?: string;
    error?: string;
  } | null = null;
  lookupLoading = false;
  addLoading = false;

  constructor(
    private fmcsaSafetyService: FmcsaSafetyService,
    private apiService: ApiService,
    private accessControl: AccessControlService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadCarriers();
  }

  loadCarriers(): void {
    this.loading = true;
    this.error = '';
    this.fmcsaSafetyService.getCarriers().subscribe({
      next: (data) => {
        this.carriers = data;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load monitored carriers';
        this.loading = false;
      },
    });
  }

  lookupCarrier(): void {
    const dot = this.lookupDotNumber.trim();
    if (!dot) return;
    this.lookupLoading = true;
    this.lookupResult = null;
    this.apiService.fmcsaLookup(dot).subscribe({
      next: (result) => {
        this.lookupResult = result;
        this.lookupLoading = false;
      },
      error: () => {
        this.lookupResult = { found: false, error: 'Lookup request failed' };
        this.lookupLoading = false;
      },
    });
  }

  addCarrier(): void {
    if (!this.lookupResult?.found) return;
    this.addLoading = true;
    this.fmcsaSafetyService
      .addCarrier({
        dot_number: this.lookupResult.dotNumber || this.lookupDotNumber.trim(),
        mc_number: this.lookupResult.mcNumber ?? undefined,
        legal_name: this.lookupResult.legalName,
        dba_name: this.lookupResult.dbaName,
      })
      .subscribe({
        next: () => {
          this.addLoading = false;
          this.closeAddForm();
          this.loadCarriers();
        },
        error: () => {
          this.addLoading = false;
          this.error = 'Failed to add carrier to monitoring';
        },
      });
  }

  removeCarrier(id: string): void {
    if (!confirm('Remove this carrier from monitoring?')) return;
    this.fmcsaSafetyService.removeCarrier(id).subscribe({
      next: () => this.loadCarriers(),
      error: () => {
        this.error = 'Failed to remove carrier';
      },
    });
  }

  canManage(): boolean {
    return this.accessControl.hasPermission('fmcsa_safety.manage');
  }

  navigateToDetail(id: string): void {
    this.router.navigate(['/safety/fmcsa/carriers', id]);
  }

  openAddForm(): void {
    this.showAddForm = true;
    this.lookupDotNumber = '';
    this.lookupResult = null;
  }

  closeAddForm(): void {
    this.showAddForm = false;
    this.lookupDotNumber = '';
    this.lookupResult = null;
  }

  sourceLabel(source: string): string {
    return source === 'operating_entity' ? 'Operating Entity' : 'Manual';
  }
}
