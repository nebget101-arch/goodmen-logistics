import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ViewChildren,
  QueryList,
  ElementRef,
} from '@angular/core';

export type StepStatus =
  | 'pending'
  | 'current'
  | 'complete'
  | 'skipped'
  | 'blocked';

export interface StepperStep {
  key: string;
  label: string;
  kicker?: string;
  value?: string;
  status: StepStatus;
}

/**
 * Horizontal status stepper for Roadside flows.
 * Renders an index circle + meta (kicker/label/value) per step with a connector
 * line between steps. Supports roving-tabindex keyboard navigation across every
 * reachable step (all except `blocked`).
 */
@Component({
  selector: 'app-status-stepper',
  templateUrl: './status-stepper.component.html',
  styleUrls: ['./status-stepper.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusStepperComponent {
  @Input() steps: StepperStep[] = [];
  @Input() activeKey = '';

  @Output() stepChange = new EventEmitter<string>();

  @ViewChildren('stepEl')
  private stepEls!: QueryList<ElementRef<HTMLElement>>;

  /** True when this step is the keyboard-focusable (tabindex=0) entry point. */
  isFocusable(step: StepperStep, index: number): boolean {
    if (step.status === 'blocked') {
      return false;
    }
    // The active step is the tab stop; otherwise the first reachable step is.
    if (step.key === this.activeKey) {
      return true;
    }
    if (
      this.steps.some((s) => s.key === this.activeKey && s.status !== 'blocked')
    ) {
      return false;
    }
    return index === this.firstReachableIndex();
  }

  trackByKey(_index: number, step: StepperStep): string {
    return step.key;
  }

  onActivate(step: StepperStep): void {
    if (step.status === 'blocked') {
      return;
    }
    this.stepChange.emit(step.key);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        this.focusReachable(this.nextReachableIndex(index));
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        this.focusReachable(this.prevReachableIndex(index));
        break;
      case 'Home':
        event.preventDefault();
        this.focusReachable(this.firstReachableIndex());
        break;
      case 'End':
        event.preventDefault();
        this.focusReachable(this.lastReachableIndex());
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        this.onActivate(this.steps[index]);
        break;
      default:
        break;
    }
  }

  private focusReachable(index: number): void {
    if (index < 0) {
      return;
    }
    const el = this.stepEls?.toArray()[index]?.nativeElement;
    el?.focus();
  }

  private isReachable(index: number): boolean {
    const step = this.steps[index];
    return !!step && step.status !== 'blocked';
  }

  private firstReachableIndex(): number {
    return this.steps.findIndex((s) => s.status !== 'blocked');
  }

  private lastReachableIndex(): number {
    for (let i = this.steps.length - 1; i >= 0; i -= 1) {
      if (this.isReachable(i)) {
        return i;
      }
    }
    return -1;
  }

  private nextReachableIndex(from: number): number {
    for (let i = from + 1; i < this.steps.length; i += 1) {
      if (this.isReachable(i)) {
        return i;
      }
    }
    // wrap to first reachable
    return this.firstReachableIndex();
  }

  private prevReachableIndex(from: number): number {
    for (let i = from - 1; i >= 0; i -= 1) {
      if (this.isReachable(i)) {
        return i;
      }
    }
    return this.lastReachableIndex();
  }
}
