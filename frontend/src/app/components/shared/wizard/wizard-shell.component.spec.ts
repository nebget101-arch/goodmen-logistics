/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  WizardShellComponent,
  WizardStepDef,
} from './wizard-shell.component';

const STEPS: WizardStepDef[] = [
  { id: 'basics', label: '1. Basics' },
  { id: 'stops', label: '2. Stops' },
  { id: 'driver', label: '3. Driver' },
  { id: 'review', label: '4. Review' },
];

describe('WizardShellComponent', () => {
  let fixture: ComponentFixture<WizardShellComponent>;
  let component: WizardShellComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WizardShellComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WizardShellComponent);
    component = fixture.componentInstance;
    component.steps = STEPS;
    component.currentStepId = 'basics';
    component.canProceed = true;
    component.mode = 'create';
    fixture.detectChanges();
  });

  it('renders one rail step per step def with correct labels', () => {
    const rail = fixture.nativeElement.querySelectorAll('.rail-step');
    expect(rail.length).toBe(STEPS.length);
    STEPS.forEach((s, i) => {
      expect(rail[i].textContent).toContain(s.label);
    });
  });

  it('marks the current step active and earlier steps done', () => {
    component.currentStepId = 'driver';
    fixture.detectChanges();

    const rail = fixture.nativeElement.querySelectorAll('.rail-step');
    expect(rail[0].classList).toContain('done');
    expect(rail[1].classList).toContain('done');
    expect(rail[2].classList).toContain('active');
    expect(rail[3].classList).not.toContain('active');
    expect(rail[3].classList).not.toContain('done');
  });

  it('disables Continue when canProceed is false', () => {
    component.canProceed = false;
    fixture.detectChanges();

    const next = fixture.nativeElement.querySelector(
      '[data-testid="wizard-next"]'
    ) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('does not emit next when canProceed is false', () => {
    component.canProceed = false;
    fixture.detectChanges();

    const spy = jasmine.createSpy('next');
    component.next.subscribe(spy);
    component.onNext();
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits next when Continue is clicked and canProceed is true', () => {
    const spy = jasmine.createSpy('next');
    component.next.subscribe(spy);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="wizard-next"]'
    ) as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('replaces Continue with Submit on the final step', () => {
    component.currentStepId = 'review';
    fixture.detectChanges();

    const next = fixture.nativeElement.querySelector('[data-testid="wizard-next"]');
    const submit = fixture.nativeElement.querySelector(
      '[data-testid="wizard-submit"]'
    ) as HTMLButtonElement;
    expect(next).toBeNull();
    expect(submit).toBeTruthy();
    expect(submit.textContent).toContain('Submit');
  });

  it('emits submit when Submit is clicked on the final step', () => {
    component.currentStepId = 'review';
    fixture.detectChanges();

    const spy = jasmine.createSpy('submit');
    component.submit.subscribe(spy);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="wizard-submit"]'
    ) as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disables Back on the first step', () => {
    component.currentStepId = 'basics';
    fixture.detectChanges();

    const back = fixture.nativeElement.querySelector(
      '[data-testid="wizard-back"]'
    ) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it('emits back when Back is clicked', () => {
    component.currentStepId = 'stops';
    fixture.detectChanges();

    const spy = jasmine.createSpy('back');
    component.back.subscribe(spy);
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="wizard-back"]'
    ) as HTMLButtonElement;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('emits stepChange when clicking a previously-completed step', () => {
    component.currentStepId = 'driver';
    fixture.detectChanges();

    const spy = jasmine.createSpy('stepChange');
    component.stepChange.subscribe(spy);
    const first = fixture.nativeElement.querySelectorAll('.rail-step')[0] as HTMLElement;
    first.click();
    expect(spy).toHaveBeenCalledWith('basics');
  });

  it('does not emit stepChange when clicking an upcoming step in create mode', () => {
    component.currentStepId = 'basics';
    fixture.detectChanges();

    const spy = jasmine.createSpy('stepChange');
    component.stepChange.subscribe(spy);
    const last = fixture.nativeElement.querySelectorAll('.rail-step')[3] as HTMLElement;
    last.click();
    expect(spy).not.toHaveBeenCalled();
  });

  describe('mode=view', () => {
    beforeEach(() => {
      component.mode = 'view';
      component.currentStepId = 'stops';
      fixture.detectChanges();
    });

    it('shows only a Close button in the footer', () => {
      const close = fixture.nativeElement.querySelector(
        '[data-testid="wizard-close"]'
      );
      const back = fixture.nativeElement.querySelector('[data-testid="wizard-back"]');
      const next = fixture.nativeElement.querySelector('[data-testid="wizard-next"]');
      const submit = fixture.nativeElement.querySelector(
        '[data-testid="wizard-submit"]'
      );
      expect(close).toBeTruthy();
      expect(back).toBeNull();
      expect(next).toBeNull();
      expect(submit).toBeNull();
    });

    it('hides Submit even on the final step', () => {
      component.currentStepId = 'review';
      fixture.detectChanges();

      const submit = fixture.nativeElement.querySelector(
        '[data-testid="wizard-submit"]'
      );
      const close = fixture.nativeElement.querySelector(
        '[data-testid="wizard-close"]'
      );
      expect(submit).toBeNull();
      expect(close).toBeTruthy();
    });

    it('emits close when Close is clicked', () => {
      const spy = jasmine.createSpy('close');
      component.close.subscribe(spy);
      const btn = fixture.nativeElement.querySelector(
        '[data-testid="wizard-close"]'
      ) as HTMLButtonElement;
      btn.click();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('allows navigation to any step via stepChange', () => {
      const spy = jasmine.createSpy('stepChange');
      component.stepChange.subscribe(spy);
      const last = fixture.nativeElement.querySelectorAll('.rail-step')[3] as HTMLElement;
      last.click();
      expect(spy).toHaveBeenCalledWith('review');
    });
  });
});
