/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { GroupedAlertRowComponent } from './grouped-alert-row.component';

describe('GroupedAlertRowComponent', () => {
  let fixture: ComponentFixture<GroupedAlertRowComponent>;
  let component: GroupedAlertRowComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, GroupedAlertRowComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(GroupedAlertRowComponent);
    component = fixture.componentInstance;
  });

  it('renders the message and applies the severity modifier', () => {
    component.severity = 'critical';
    component.message = '12 vehicles overdue for preventive maintenance';
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.grouped-alert-row') as HTMLElement;
    expect(row.classList).toContain('grouped-alert-row--critical');
    expect(row.textContent).toContain('12 vehicles overdue for preventive maintenance');
  });

  it('omits the count chip and expand toggle when count <= 1', () => {
    component.count = 1;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.grouped-alert-row__count')).toBeNull();
    expect(fixture.nativeElement.querySelector('.grouped-alert-row__expand')).toBeNull();
  });

  it('renders the count chip with the optional unit', () => {
    component.count = 12;
    component.countUnit = 'vehicles';
    fixture.detectChanges();
    const chip = fixture.nativeElement.querySelector('.grouped-alert-row__count') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent?.trim()).toBe('12 vehicles');
  });

  it('toggles expanded state and emits expandedChange', () => {
    component.count = 5;
    fixture.detectChanges();
    const spy = jasmine.createSpy('expandedChange');
    component.expandedChange.subscribe(spy);
    const btn = fixture.nativeElement.querySelector('.grouped-alert-row__expand') as HTMLButtonElement;
    btn.click();
    expect(component.expanded).toBeTrue();
    expect(spy).toHaveBeenCalledWith(true);
    btn.click();
    expect(component.expanded).toBeFalse();
    expect(spy).toHaveBeenCalledWith(false);
  });

  it('renders the body when expanded', () => {
    component.count = 5;
    component.expanded = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.grouped-alert-row__body')).toBeTruthy();
  });

  it('does not render the primary CTA when primaryAction is null', () => {
    component.primaryAction = null;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.grouped-alert-row__cta')).toBeNull();
  });

  it('emits primaryActionClick when the CTA is clicked', () => {
    component.primaryAction = { label: 'View list' };
    fixture.detectChanges();
    const spy = jasmine.createSpy('primaryActionClick');
    component.primaryActionClick.subscribe(spy);
    const cta = fixture.nativeElement.querySelector('.grouped-alert-row__cta') as HTMLButtonElement;
    cta.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits dismiss when the dismiss button is clicked', () => {
    fixture.detectChanges();
    const spy = jasmine.createSpy('dismiss');
    component.dismiss.subscribe(spy);
    const btn = fixture.nativeElement.querySelector('.grouped-alert-row__dismiss') as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('hides the dismiss button when dismissible=false', () => {
    component.dismissible = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.grouped-alert-row__dismiss')).toBeNull();
  });

  it('renders the embedded severity badge with the correct severity', () => {
    component.severity = 'high';
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('app-severity-badge .severity-badge') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.classList).toContain('severity-badge--high');
  });
});
