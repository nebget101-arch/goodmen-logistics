import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ConfidenceBadgeComponent } from './confidence-badge.component';

describe('ConfidenceBadgeComponent', () => {
  let fixture: ComponentFixture<ConfidenceBadgeComponent>;
  let component: ConfidenceBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ConfidenceBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfidenceBadgeComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when confidence is null/undefined/NaN', () => {
    component.confidence = null;
    fixture.detectChanges();
    expect(component.bucket).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.confidence-badge'))
      .toBeNull();

    component.confidence = undefined as any;
    fixture.detectChanges();
    expect(component.bucket).toBeNull();

    component.confidence = NaN;
    fixture.detectChanges();
    expect(component.bucket).toBeNull();
  });

  it('classifies high (≥0.85)', () => {
    component.confidence = 0.85;
    expect(component.bucket).toBe('high');
    expect(component.cssClass).toBe('confidence-badge--high');
    expect(component.label).toBe('High');

    component.confidence = 0.95;
    expect(component.bucket).toBe('high');
  });

  it('classifies medium (0.6–0.849)', () => {
    component.confidence = 0.6;
    expect(component.bucket).toBe('medium');

    component.confidence = 0.84;
    expect(component.bucket).toBe('medium');
    expect(component.cssClass).toBe('confidence-badge--medium');
    expect(component.label).toBe('Medium');
  });

  it('classifies low (<0.6)', () => {
    component.confidence = 0.59;
    expect(component.bucket).toBe('low');

    component.confidence = 0;
    expect(component.bucket).toBe('low');
    expect(component.cssClass).toBe('confidence-badge--low');
    expect(component.label).toBe('Low');
  });

  it('formats pct as rounded integer percent', () => {
    component.confidence = 0.876;
    expect(component.pct).toBe('88%');

    component.confidence = 0.5;
    expect(component.pct).toBe('50%');

    component.confidence = null;
    expect(component.pct).toBe('');
  });
});
