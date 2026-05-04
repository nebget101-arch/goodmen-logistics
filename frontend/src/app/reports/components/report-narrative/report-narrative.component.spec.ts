/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ReportNarrativeComponent } from './report-narrative.component';

describe('ReportNarrativeComponent', () => {
  let fixture: ComponentFixture<ReportNarrativeComponent>;
  let component: ReportNarrativeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ReportNarrativeComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ReportNarrativeComponent);
    component = fixture.componentInstance;
  });

  it('renders the narrative text when service emits', () => {
    component.narrative = {
      narrative: 'Revenue rose 12% MoM, driven by stronger spot rates.',
      generatedAt: '2026-05-04T18:00:00.000Z'
    };
    component.loading = false;
    component.failed = false;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('.narrative');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-busy')).toBe('false');
    const text = host.querySelector('.narrative__text');
    expect(text?.textContent?.trim()).toBe(
      'Revenue rose 12% MoM, driven by stronger spot rates.'
    );
    expect(host.querySelector('.narrative__skeleton')).toBeNull();
  });

  it('shows shimmer placeholder while loading and no narrative yet', () => {
    component.narrative = null;
    component.loading = true;
    component.failed = false;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const region = host.querySelector('.narrative');
    expect(region).toBeTruthy();
    expect(region!.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.narrative__skeleton')).toBeTruthy();
    expect(host.querySelector('.narrative__text')).toBeNull();
  });

  it('hides the panel completely on error (no toast spam)', () => {
    component.narrative = null;
    component.loading = false;
    component.failed = true;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.narrative')).toBeNull();
    expect(host.textContent?.trim()).toBe('');
  });

  it('hides the panel when there is no narrative, no loading, and no failure', () => {
    component.narrative = null;
    component.loading = false;
    component.failed = false;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.narrative')).toBeNull();
  });

  it('formats the generatedAt timestamp into a short label', () => {
    component.narrative = {
      narrative: 'Profit margin steady at 18%.',
      generatedAt: '2026-05-04T15:30:00.000Z'
    };
    component.loading = false;
    component.failed = false;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const ts = host.querySelector('.narrative__timestamp');
    expect(ts).toBeTruthy();
    expect(ts!.textContent!.trim().length).toBeGreaterThan(0);
  });
});
