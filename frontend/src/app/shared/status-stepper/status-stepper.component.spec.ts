import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatusStepperComponent, StepperStep } from './status-stepper.component';

describe('StatusStepperComponent', () => {
  let component: StatusStepperComponent;
  let fixture: ComponentFixture<StatusStepperComponent>;

  const steps: StepperStep[] = [
    { key: 'a', label: 'First', kicker: 'Step 1', status: 'complete' },
    { key: 'b', label: 'Second', value: '12 min', status: 'current' },
    { key: 'c', label: 'Third', status: 'pending' },
    { key: 'd', label: 'Fourth', status: 'blocked' },
    { key: 'e', label: 'Fifth', status: 'skipped' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [StatusStepperComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusStepperComponent);
    component = fixture.componentInstance;
    component.steps = steps;
    component.activeKey = 'b';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders one node button per step', () => {
    const nodes = fixture.nativeElement.querySelectorAll('.status-stepper__node');
    expect(nodes.length).toBe(steps.length);
  });

  it('marks the active step with aria-current="step"', () => {
    const current: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[aria-current="step"]'
    );
    expect(current).toBeTruthy();
    expect(current?.textContent).toContain('Second');
  });

  it('shows a checkmark glyph for complete steps', () => {
    const check = fixture.nativeElement.querySelector('.status-stepper__check');
    expect(check).toBeTruthy();
  });

  it('renders blocked steps as disabled and not focusable', () => {
    const blocked: HTMLButtonElement = fixture.nativeElement.querySelectorAll(
      '.status-stepper__node'
    )[3];
    expect(blocked.classList).toContain('is-blocked');
    expect(blocked.disabled).toBeTrue();
    expect(blocked.getAttribute('tabindex')).toBe('-1');
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
  });

  it('emits stepChange on activation of a reachable step', () => {
    spyOn(component.stepChange, 'emit');
    component.onActivate(steps[2]);
    expect(component.stepChange.emit).toHaveBeenCalledWith('c');
  });

  it('does not emit stepChange for blocked steps', () => {
    spyOn(component.stepChange, 'emit');
    component.onActivate(steps[3]);
    expect(component.stepChange.emit).not.toHaveBeenCalled();
  });

  it('Enter key emits stepChange for the focused step', () => {
    spyOn(component.stepChange, 'emit');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    component.onKeydown(event, 2);
    expect(component.stepChange.emit).toHaveBeenCalledWith('c');
  });

  it('the active step is the tabindex=0 entry point', () => {
    expect(component.isFocusable(steps[1], 1)).toBeTrue();
    expect(component.isFocusable(steps[0], 0)).toBeFalse();
  });

  it('ArrowRight moves focus to the next reachable step (skipping blocked)', () => {
    fixture.detectChanges();
    const nodes: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.status-stepper__node')
    );
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    // from index 2 (pending) the next reachable is index 4 (skipped), skipping 3 (blocked)
    component.onKeydown(event, 2);
    expect(document.activeElement).toBe(nodes[4]);
  });
});
