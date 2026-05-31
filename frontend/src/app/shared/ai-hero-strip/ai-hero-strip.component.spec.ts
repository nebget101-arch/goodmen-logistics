/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AiHeroStripComponent, HeroItem } from './ai-hero-strip.component';

const item = (severity: HeroItem['severity'], count = 1): HeroItem => ({
  severity,
  count,
  label: `${severity} items`,
  routerLink: '/loads'
});

describe('AiHeroStripComponent.dominantSeverity (FN-1636)', () => {
  it('returns "good" for empty / null / undefined', () => {
    expect(AiHeroStripComponent.dominantSeverity([])).toBe('good');
    expect(AiHeroStripComponent.dominantSeverity(null)).toBe('good');
    expect(AiHeroStripComponent.dominantSeverity(undefined)).toBe('good');
  });

  it('returns the single severity when one item', () => {
    expect(AiHeroStripComponent.dominantSeverity([item('info')])).toBe('info');
    expect(AiHeroStripComponent.dominantSeverity([item('warning')])).toBe('warning');
    expect(AiHeroStripComponent.dominantSeverity([item('critical')])).toBe('critical');
  });

  it('picks the highest severity regardless of order', () => {
    expect(AiHeroStripComponent.dominantSeverity([item('info'), item('critical'), item('warning')])).toBe(
      'critical'
    );
    expect(AiHeroStripComponent.dominantSeverity([item('info'), item('warning')])).toBe('warning');
  });
});

describe('AiHeroStripComponent (DOM)', () => {
  let fixture: ComponentFixture<AiHeroStripComponent>;
  let component: AiHeroStripComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiHeroStripComponent],
      imports: [RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(AiHeroStripComponent);
    component = fixture.componentInstance;
  });

  it('renders the nominal message when empty and reflects data-severity="good"', () => {
    component.items = [];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hero-nominal').textContent).toContain(
      'All systems nominal'
    );
    expect(fixture.nativeElement.querySelector('.hero-strip').getAttribute('data-severity')).toBe(
      'good'
    );
  });

  it('renders at most three chips and exposes the dominant severity', () => {
    component.items = [item('info'), item('warning'), item('critical'), item('info')];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.hero-chip').length).toBe(3);
    expect(fixture.nativeElement.querySelector('.hero-strip').getAttribute('data-severity')).toBe(
      'critical'
    );
  });
});
