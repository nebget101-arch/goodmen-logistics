/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AiAlertRowComponent } from './ai-alert-row.component';

describe('AiAlertRowComponent (FN-1636)', () => {
  let fixture: ComponentFixture<AiAlertRowComponent>;
  let component: AiAlertRowComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiAlertRowComponent],
      imports: [RouterTestingModule]
    }).compileComponents();
    fixture = TestBed.createComponent(AiAlertRowComponent);
    component = fixture.componentInstance;
    component.category = 'Compliance';
    component.message = 'HOS violation pending review';
    component.severity = 'critical';
    fixture.detectChanges();
  });

  it('maps severity to an accessible label', () => {
    component.severity = 'critical';
    expect(component.severityLabel).toBe('Critical');
    component.severity = 'warning';
    expect(component.severityLabel).toBe('Warning');
    component.severity = 'good';
    expect(component.severityLabel).toBe('Resolved');
    component.severity = 'info';
    expect(component.severityLabel).toBe('Info');
  });

  it('emits acknowledge when the check action is pressed', () => {
    let acked = 0;
    component.acknowledge.subscribe(() => acked++);
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.btn-icon')
    );
    buttons[0].click();
    expect(acked).toBe(1);
  });

  it('emits snooze when the snooze action is pressed', () => {
    let snoozed = 0;
    component.snooze.subscribe(() => snoozed++);
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.btn-icon')
    );
    buttons[1].click();
    expect(snoozed).toBe(1);
  });

  it('renders a screen-reader severity label and a colored pip', () => {
    expect(fixture.nativeElement.querySelector('.sr-only').textContent).toContain('Critical');
    expect(fixture.nativeElement.querySelector('.alert-pip').getAttribute('data-severity')).toBe(
      'critical'
    );
  });
});
