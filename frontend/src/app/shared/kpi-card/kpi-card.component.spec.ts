/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { KpiCardComponent } from './kpi-card.component';

describe('KpiCardComponent.composeAriaLabel (FN-1636)', () => {
  it('composes label + value only', () => {
    expect(KpiCardComponent.composeAriaLabel('Active Loads', 42)).toBe('Active Loads: 42');
  });

  it('appends the subline when present', () => {
    expect(KpiCardComponent.composeAriaLabel('Revenue', '$12k', '3 invoices')).toBe(
      'Revenue: $12k, 3 invoices'
    );
  });

  it('appends a trend phrase per direction', () => {
    expect(
      KpiCardComponent.composeAriaLabel('Loads', 10, '', { direction: 'up', deltaText: '+12%' })
    ).toBe('Loads: 10, trending up, +12%');
    expect(
      KpiCardComponent.composeAriaLabel('Loads', 10, '', { direction: 'down', deltaText: '-4%' })
    ).toBe('Loads: 10, trending down, -4%');
    expect(
      KpiCardComponent.composeAriaLabel('Loads', 10, '', { direction: 'flat', deltaText: 'no change' })
    ).toBe('Loads: 10, flat, no change');
  });
});

describe('KpiCardComponent (DOM)', () => {
  let fixture: ComponentFixture<KpiCardComponent>;
  let component: KpiCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [KpiCardComponent],
      imports: [RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(KpiCardComponent);
    component = fixture.componentInstance;
  });

  it('renders a non-link <div> with the composed aria-label when routerLink is absent', () => {
    component.label = 'Fleet Health';
    component.value = '98%';
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.kpi-card');
    expect(card.tagName.toLowerCase()).toBe('div');
    expect(card.getAttribute('aria-label')).toBe('Fleet Health: 98%');
  });

  it('renders an <a> when routerLink is set', () => {
    component.label = 'Loads';
    component.value = 7;
    component.routerLink = '/loads';
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.kpi-card');
    expect(card.tagName.toLowerCase()).toBe('a');
    expect(card.classList).toContain('is-link');
  });

  it('reflects status onto data-status', () => {
    component.status = 'critical';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.kpi-card').getAttribute('data-status')).toBe(
      'critical'
    );
  });
});
