/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ReportAnomaliesComponent } from './report-anomalies.component';
import { ReportAnomaly } from '../../reports.models';

describe('ReportAnomaliesComponent (FN-1131)', () => {
  let fixture: ComponentFixture<ReportAnomaliesComponent>;
  let component: ReportAnomaliesComponent;

  const sample: ReportAnomaly[] = [
    { metric: 'revenue', value: 12345, deltaPct: -0.32, severity: 'warning', context: 'Below 90-day mean by 1.8σ' },
    { metric: 'rpm', value: 1.42, deltaPct: 0.08, severity: 'info' },
    { metric: 'expenses', value: 9876, deltaPct: 0.51, severity: 'critical', context: 'Spike vs prior period' }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ReportAnomaliesComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ReportAnomaliesComponent);
    component = fixture.componentInstance;
  });

  it('hides the row when no anomalies are provided', () => {
    component.anomalies = [];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.anomaly-row')).toBeNull();
  });

  it('hides the row when anomalies is null/undefined', () => {
    component.anomalies = null;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.anomaly-row')).toBeNull();

    component.anomalies = undefined;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.anomaly-row')).toBeNull();
  });

  it('renders one chip per anomaly with severity-driven class', () => {
    component.anomalies = sample;
    fixture.detectChanges();
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.anomaly-chip');
    expect(chips.length).toBe(3);
    expect(chips[0].classList).toContain('anomaly-chip--warning');
    expect(chips[1].classList).toContain('anomaly-chip--info');
    expect(chips[2].classList).toContain('anomaly-chip--critical');
  });

  it('exposes role="status" on the chip row for screen readers', () => {
    component.anomalies = sample;
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.anomaly-row') as HTMLElement;
    expect(row.getAttribute('role')).toBe('status');
    expect(row.getAttribute('aria-live')).toBe('polite');
  });

  it('labels each chip with severity and metric for assistive tech', () => {
    component.anomalies = sample;
    fixture.detectChanges();
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll('.anomaly-chip');
    const warnLabel = chips[0].getAttribute('aria-label') || '';
    expect(warnLabel).toContain('warning');
    expect(warnLabel).toContain('revenue');
    expect(warnLabel).toContain('Below 90-day mean by 1.8σ');
  });

  it('removes a chip when clicked (per-session dismissal)', () => {
    component.anomalies = sample;
    fixture.detectChanges();
    const firstChip = (fixture.nativeElement as HTMLElement).querySelector('.anomaly-chip') as HTMLButtonElement | null;
    firstChip!.click();
    fixture.detectChanges();
    const remaining = (fixture.nativeElement as HTMLElement).querySelectorAll('.anomaly-chip');
    expect(remaining.length).toBe(2);
    expect(component.visibleAnomalies.length).toBe(2);
  });

  it('hides the entire row once every chip is dismissed', () => {
    component.anomalies = [sample[0]];
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.anomaly-chip') as HTMLButtonElement | null;
    chip!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.anomaly-row')).toBeNull();
  });

  it('formats deltaPct as a signed percentage', () => {
    expect(component.formatDelta(-0.32)).toBe('-32.0%');
    expect(component.formatDelta(0.08)).toBe('+8.0%');
    expect(component.formatDelta(0)).toBe('+0.0%');
  });

  it('returns empty string for non-finite deltaPct', () => {
    expect(component.formatDelta(undefined)).toBe('');
    expect(component.formatDelta(null)).toBe('');
    expect(component.formatDelta(Number.NaN)).toBe('');
  });

  it('maps severity to a Material Symbol icon', () => {
    expect(component.iconFor('info')).toBe('info');
    expect(component.iconFor('warning')).toBe('warning');
    expect(component.iconFor('critical')).toBe('priority_high');
  });
});
