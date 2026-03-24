import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { ApiService } from '../../../services/api.service';

interface ClearanceRequirement {
  key: string;
  label: string;
  met: boolean;
  link?: string;
}

@Component({
  selector: 'app-pre-employment-gate',
  templateUrl: './pre-employment-gate.component.html',
  styleUrls: ['./pre-employment-gate.component.css']
})
export class PreEmploymentGateComponent implements OnChanges {
  @Input() driverId = '';

  loading = false;
  cleared = false;
  requirements: ClearanceRequirement[] = [];
  missingItems: string[] = [];

  /** Default requirements shown when the API does not return structured data */
  private readonly defaultRequirements: ClearanceRequirement[] = [
    { key: 'pre_employment_drug_test', label: 'Pre-employment drug test', met: false },
    { key: 'clearinghouse_full_query', label: 'Clearinghouse full query', met: false },
    { key: 'medical_certificate', label: 'Medical certificate', met: false },
    { key: 'road_test_cdl', label: 'Road test / CDL on file', met: false }
  ];

  constructor(private apiService: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['driverId'] && this.driverId) {
      this.loadClearance();
    }
  }

  loadClearance(): void {
    this.loading = true;
    this.apiService.getDriverClearanceStatus(this.driverId).subscribe({
      next: (status) => {
        this.cleared = status.cleared;
        this.missingItems = status.missingItems || [];

        if (status.requirements && status.requirements.length > 0) {
          this.requirements = status.requirements;
        } else {
          // Derive from missingItems against default list
          this.requirements = this.defaultRequirements.map(req => ({
            ...req,
            met: !this.missingItems.some(
              m => m.toLowerCase().includes(req.key.replace(/_/g, ' '))
                || m.toLowerCase().includes(req.label.toLowerCase())
            )
          }));
        }
        this.loading = false;
      },
      error: () => {
        // Show all as unknown/unchecked
        this.cleared = false;
        this.requirements = this.defaultRequirements.map(r => ({ ...r, met: false }));
        this.missingItems = this.defaultRequirements.map(r => r.label);
        this.loading = false;
      }
    });
  }

  get unmetRequirements(): ClearanceRequirement[] {
    return this.requirements.filter(r => !r.met);
  }
}
