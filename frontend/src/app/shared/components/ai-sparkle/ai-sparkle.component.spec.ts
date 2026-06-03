/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { AiSparkleComponent } from './ai-sparkle.component';

describe('AiSparkleComponent.tierFor', () => {
  it('returns "high" for confidence ≥ 95', () => {
    expect(AiSparkleComponent.tierFor(95)).toBe('high');
    expect(AiSparkleComponent.tierFor(99.9)).toBe('high');
    expect(AiSparkleComponent.tierFor(100)).toBe('high');
  });

  it('returns "medium" for confidence in [80, 95)', () => {
    expect(AiSparkleComponent.tierFor(80)).toBe('medium');
    expect(AiSparkleComponent.tierFor(87)).toBe('medium');
    expect(AiSparkleComponent.tierFor(94.99)).toBe('medium');
  });

  it('returns "low" for confidence < 80', () => {
    expect(AiSparkleComponent.tierFor(79.999)).toBe('low');
    expect(AiSparkleComponent.tierFor(50)).toBe('low');
    expect(AiSparkleComponent.tierFor(0)).toBe('low');
  });

  it('defaults to "high" when confidence is null/undefined/NaN', () => {
    expect(AiSparkleComponent.tierFor(null)).toBe('high');
    expect(AiSparkleComponent.tierFor(undefined)).toBe('high');
    expect(AiSparkleComponent.tierFor(Number.NaN)).toBe('high');
  });
});

describe('AiSparkleComponent', () => {
  let fixture: ComponentFixture<AiSparkleComponent>;
  let component: AiSparkleComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [AiSparkleComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(AiSparkleComponent);
    component = fixture.componentInstance;
  });

  it('applies the tier-high class for confidence ≥ 95', () => {
    component.confidence = 98;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    expect(btn.classList).toContain('ai-sparkle--high');
    expect(btn.classList).not.toContain('ai-sparkle--low');
  });

  it('applies the tier-medium class for confidence in [80,95)', () => {
    component.confidence = 85;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    expect(btn.classList).toContain('ai-sparkle--medium');
  });

  it('applies the tier-low class for confidence < 80', () => {
    component.confidence = 42;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    expect(btn.classList).toContain('ai-sparkle--low');
  });

  it('emits sparkleClick when the glyph is clicked', () => {
    const spy = jasmine.createSpy('sparkleClick');
    component.sparkleClick.subscribe(spy);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reflects tooltip text on the button title attribute', () => {
    component.tooltip = 'Auto-extracted from rate confirmation PDF';
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    expect(btn.getAttribute('title')).toBe('Auto-extracted from rate confirmation PDF');
  });

  it('hides the glyph while preserving layout when visible=false', () => {
    component.visible = false;
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.ai-sparkle') as HTMLElement;
    expect(btn.classList).toContain('ai-sparkle--hidden');
  });
});
