import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface WizardStepDef {
  id: string;
  label: string;
  icon?: string;
}

export type WizardMode = 'create' | 'edit' | 'view';

@Component({
  selector: 'app-wizard-shell',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wizard-shell.component.html',
  styleUrls: ['./wizard-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardShellComponent {
  @Input() steps: WizardStepDef[] = [];
  @Input() currentStepId: string | null = null;
  @Input() canProceed = false;
  @Input() mode: WizardMode = 'create';

  @Output() stepChange = new EventEmitter<string>();
  @Output() back = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() submit = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  get currentIndex(): number {
    if (!this.currentStepId) return 0;
    const idx = this.steps.findIndex((s) => s.id === this.currentStepId);
    return idx < 0 ? 0 : idx;
  }

  get isFirstStep(): boolean {
    return this.currentIndex === 0;
  }

  get isFinalStep(): boolean {
    return this.steps.length > 0 && this.currentIndex === this.steps.length - 1;
  }

  get isView(): boolean {
    return this.mode === 'view';
  }

  isDone(index: number): boolean {
    return index < this.currentIndex;
  }

  isActive(index: number): boolean {
    return index === this.currentIndex;
  }

  isClickable(index: number): boolean {
    if (this.isView) return index !== this.currentIndex;
    return index < this.currentIndex;
  }

  onStepClick(step: WizardStepDef, index: number): void {
    if (!this.isClickable(index)) return;
    this.stepChange.emit(step.id);
  }

  onBack(): void {
    this.back.emit();
  }

  onNext(): void {
    if (!this.canProceed) return;
    this.next.emit();
  }

  onSubmit(): void {
    if (!this.canProceed) return;
    this.submit.emit();
  }

  onClose(): void {
    this.close.emit();
  }

  trackByStepId(_index: number, step: WizardStepDef): string {
    return step.id;
  }
}
