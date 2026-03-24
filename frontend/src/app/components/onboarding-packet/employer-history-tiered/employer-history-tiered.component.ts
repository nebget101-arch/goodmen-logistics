import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

export interface DetailedEmployer {
  employerName: string;
  employerPhone: string;
  employerStreet: string;
  employerCity: string;
  employerState: string;
  employerZip: string;
  fromDate: string;
  toDate: string;
  positionHeld: string;
  reasonForLeaving: string;
  subjectToFmcsr: boolean | null;
  dotRegulated: boolean | null;
}

export interface CmvEmployer {
  employerName: string;
  employerStreet: string;
  employerCity: string;
  employerState: string;
  employerZip: string;
  fromDate: string;
  toDate: string;
  cmvType: string;
}

export interface EmployerHistoryData {
  detailedEmployers: DetailedEmployer[];
  cmvEmployers: CmvEmployer[];
}

function createDetailedEmployer(): DetailedEmployer {
  return {
    employerName: '',
    employerPhone: '',
    employerStreet: '',
    employerCity: '',
    employerState: '',
    employerZip: '',
    fromDate: '',
    toDate: '',
    positionHeld: '',
    reasonForLeaving: '',
    subjectToFmcsr: null,
    dotRegulated: null
  };
}

function createCmvEmployer(): CmvEmployer {
  return {
    employerName: '',
    employerStreet: '',
    employerCity: '',
    employerState: '',
    employerZip: '',
    fromDate: '',
    toDate: '',
    cmvType: ''
  };
}

@Component({
  selector: 'app-employer-history-tiered',
  templateUrl: './employer-history-tiered.component.html',
  styleUrls: ['./employer-history-tiered.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmployerHistoryTieredComponent {
  @Input()
  set data(value: EmployerHistoryData | null) {
    if (value) {
      this.detailedEmployers = value.detailedEmployers?.length
        ? value.detailedEmployers.map((e) => ({ ...e }))
        : [createDetailedEmployer()];
      this.cmvEmployers = value.cmvEmployers?.length
        ? value.cmvEmployers.map((e) => ({ ...e }))
        : [createCmvEmployer()];
    }
  }

  @Output() dataChange = new EventEmitter<EmployerHistoryData>();

  detailedEmployers: DetailedEmployer[] = [createDetailedEmployer()];
  cmvEmployers: CmvEmployer[] = [createCmvEmployer()];

  addDetailedEmployer(): void {
    this.detailedEmployers = [...this.detailedEmployers, createDetailedEmployer()];
    this.emitChange();
  }

  removeDetailedEmployer(index: number): void {
    if (this.detailedEmployers.length <= 1) return;
    this.detailedEmployers = this.detailedEmployers.filter((_, i) => i !== index);
    this.emitChange();
  }

  addCmvEmployer(): void {
    this.cmvEmployers = [...this.cmvEmployers, createCmvEmployer()];
    this.emitChange();
  }

  removeCmvEmployer(index: number): void {
    if (this.cmvEmployers.length <= 1) return;
    this.cmvEmployers = this.cmvEmployers.filter((_, i) => i !== index);
    this.emitChange();
  }

  trackByIndex(index: number): number {
    return index;
  }

  emitChange(): void {
    this.dataChange.emit({
      detailedEmployers: this.detailedEmployers,
      cmvEmployers: this.cmvEmployers
    });
  }
}
