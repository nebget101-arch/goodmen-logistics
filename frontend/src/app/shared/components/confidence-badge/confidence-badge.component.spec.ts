/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ConfidenceBadgeComponent } from './confidence-badge.component';

describe('ConfidenceBadgeComponent.fieldTierFor (FN-887)', () => {
  it('returns "red" for score < 0.6', () => {
    expect(ConfidenceBadgeComponent.fieldTierFor(0)).toBe('red');
    expect(ConfidenceBadgeComponent.fieldTierFor(0.3)).toBe('red');
    expect(ConfidenceBadgeComponent.fieldTierFor(0.599)).toBe('red');
  });

  it('returns "amber" for score in [0.6, 0.85)', () => {
    expect(ConfidenceBadgeComponent.fieldTierFor(0.6)).toBe('amber');
    expect(ConfidenceBadgeComponent.fieldTierFor(0.75)).toBe('amber');
    expect(ConfidenceBadgeComponent.fieldTierFor(0.849)).toBe('amber');
  });

  it('returns "none" for score ≥ 0.85', () => {
    expect(ConfidenceBadgeComponent.fieldTierFor(0.85)).toBe('none');
    expect(ConfidenceBadgeComponent.fieldTierFor(0.95)).toBe('none');
    expect(ConfidenceBadgeComponent.fieldTierFor(1)).toBe('none');
  });

  it('returns "none" when score is null/undefined/NaN', () => {
    expect(ConfidenceBadgeComponent.fieldTierFor(null)).toBe('none');
    expect(ConfidenceBadgeComponent.fieldTierFor(undefined)).toBe('none');
    expect(ConfidenceBadgeComponent.fieldTierFor(Number.NaN)).toBe('none');
  });
});

describe('ConfidenceBadgeComponent.tierFor', () => {
  it('returns "high" for confidence ≥ 95', () => {
    expect(ConfidenceBadgeComponent.tierFor(95)).toBe('high');
    expect(ConfidenceBadgeComponent.tierFor(98)).toBe('high');
    expect(ConfidenceBadgeComponent.tierFor(100)).toBe('high');
  });

  it('returns "medium" for confidence in [80, 95)', () => {
    expect(ConfidenceBadgeComponent.tierFor(80)).toBe('medium');
    expect(ConfidenceBadgeComponent.tierFor(90)).toBe('medium');
    expect(ConfidenceBadgeComponent.tierFor(94.99)).toBe('medium');
  });

  it('returns "low" for confidence < 80', () => {
    expect(ConfidenceBadgeComponent.tierFor(79.999)).toBe('low');
    expect(ConfidenceBadgeComponent.tierFor(10)).toBe('low');
  });

  it('falls back to "medium" when confidence is null/NaN', () => {
    expect(ConfidenceBadgeComponent.tierFor(null)).toBe('medium');
    expect(ConfidenceBadgeComponent.tierFor(undefined)).toBe('medium');
    expect(ConfidenceBadgeComponent.tierFor(Number.NaN)).toBe('medium');
  });
});

describe('ConfidenceBadgeComponent', () => {
  let fixture: ComponentFixture<ConfidenceBadgeComponent>;
  let component: ConfidenceBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, ConfidenceBadgeComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ConfidenceBadgeComponent);
    component = fixture.componentInstance;
  });

  it('renders the high-tier label and class at ≥95%', () => {
    component.confidence = 97.4;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    expect(btn.classList).toContain('confidence-badge--high');
    expect(btn.textContent).toContain('97% confidence');
  });

  it('renders the medium-tier review copy in [80,95)', () => {
    component.confidence = 88;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    expect(btn.classList).toContain('confidence-badge--medium');
    expect(btn.textContent).toContain('88% — review');
  });

  it('renders the low-tier verify copy below 80%', () => {
    component.confidence = 62.3;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    expect(btn.classList).toContain('confidence-badge--low');
    expect(btn.textContent).toContain('62% — please verify');
  });

  it('respects an explicit label override', () => {
    component.confidence = 91;
    component.label = 'Needs your eyes';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    expect(btn.textContent).toContain('Needs your eyes');
    expect(btn.textContent).not.toContain('review');
  });

  it('rounds the percent for display', () => {
    component.confidence = 82.6;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    expect(btn.textContent).toContain('83% — review');
  });

  it('renders a red field-variant pill for score < 0.6', () => {
    component.variant = 'field';
    component.score = 0.42;
    fixture.detectChanges();
    const pill = fixture.nativeElement.querySelector('.confidence-badge--field') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.classList).toContain('confidence-badge--field-red');
    expect(pill.textContent).toContain('Needs review');
  });

  it('renders an amber field-variant pill for score in [0.6, 0.85)', () => {
    component.variant = 'field';
    component.score = 0.72;
    fixture.detectChanges();
    const pill = fixture.nativeElement.querySelector('.confidence-badge--field') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.classList).toContain('confidence-badge--field-amber');
    expect(pill.textContent).toContain('Verify');
  });

  it('hides the field-variant pill for score ≥ 0.85', () => {
    component.variant = 'field';
    component.score = 0.92;
    fixture.detectChanges();
    const pill = fixture.nativeElement.querySelector('.confidence-badge--field') as HTMLElement;
    expect(pill.classList).toContain('confidence-badge--field-hidden');
  });

  it('field variant does not render the card button', () => {
    component.variant = 'field';
    component.score = 0.5;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.confidence-badge')).toBeNull();
  });

  it('emits chipClick and stops propagation when clicked', () => {
    const spy = jasmine.createSpy('chipClick');
    component.chipClick.subscribe(spy);
    component.confidence = 70;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.confidence-badge') as HTMLElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    spyOn(event, 'stopPropagation').and.callThrough();
    btn.dispatchEvent(event);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalled();
  });
});
