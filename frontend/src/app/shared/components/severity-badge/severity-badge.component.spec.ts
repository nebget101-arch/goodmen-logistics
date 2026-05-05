/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { SeverityBadgeComponent } from './severity-badge.component';

describe('SeverityBadgeComponent.rank', () => {
  it('orders critical < high < medium < low', () => {
    expect(SeverityBadgeComponent.rank('critical')).toBeLessThan(SeverityBadgeComponent.rank('high'));
    expect(SeverityBadgeComponent.rank('high')).toBeLessThan(SeverityBadgeComponent.rank('medium'));
    expect(SeverityBadgeComponent.rank('medium')).toBeLessThan(SeverityBadgeComponent.rank('low'));
  });

  it('returns MAX_SAFE_INTEGER for null/undefined so unknowns sort last', () => {
    expect(SeverityBadgeComponent.rank(null)).toBe(Number.MAX_SAFE_INTEGER);
    expect(SeverityBadgeComponent.rank(undefined)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('SeverityBadgeComponent', () => {
  let fixture: ComponentFixture<SeverityBadgeComponent>;
  let component: SeverityBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, SeverityBadgeComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SeverityBadgeComponent);
    component = fixture.componentInstance;
  });

  it('applies the critical modifier and capitalized label', () => {
    component.severity = 'critical';
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.severity-badge') as HTMLElement;
    expect(el.classList).toContain('severity-badge--critical');
    expect(el.textContent).toContain('Critical');
  });

  it('renders High / Medium / Low correctly', () => {
    for (const sev of ['high', 'medium', 'low'] as const) {
      component.severity = sev;
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('.severity-badge') as HTMLElement;
      expect(el.classList).toContain(`severity-badge--${sev}`);
    }
  });

  it('renders the pip by default and hides it when showPip=false', () => {
    component.severity = 'high';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.severity-badge__pip')).toBeTruthy();

    component.showPip = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.severity-badge__pip')).toBeNull();
  });

  it('respects an explicit label override', () => {
    component.severity = 'low';
    component.label = 'Informational';
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.severity-badge') as HTMLElement;
    expect(el.textContent).toContain('Informational');
    expect(el.textContent).not.toContain('Low');
  });

  it('exposes an aria-label that announces the severity', () => {
    component.severity = 'medium';
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.severity-badge') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Severity: Medium');
  });
});
