import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { KeyboardShortcutsService } from '../../../shared/services/keyboard-shortcuts.service';

export interface WizardStep {
  label: string;
  icon: string;
}

/**
 * LoadWizardComponent — shell container for the 4-step load creation wizard.
 *
 * Responsibilities (FN-732 scope):
 *  - Render a 4-step progress bar with active/completed/locked states
 *  - Expose Next / Back / jump-to-step navigation (forward jump requires prior steps valid)
 *  - Keyboard shortcuts: Enter=Next, Esc=Cancel, Cmd+S=Save, Cmd+Shift+S=Save&New
 *  - Unsaved-changes confirmation dialog when closing with isDirty=true
 *
 * Step content is projected via <ng-content> — the parent controls which step
 * is visible using [activeStep] two-way binding.
 */
@Component({
  selector: 'app-load-wizard',
  templateUrl: './load-wizard.component.html',
  styleUrls: ['./load-wizard.component.scss'],
})
export class LoadWizardComponent implements OnInit, OnDestroy {

  readonly STEPS: WizardStep[] = [
    { label: 'Basics',             icon: 'assignment' },
    { label: 'Stops',              icon: 'place' },
    { label: 'Driver & Equipment', icon: 'local_shipping' },
    { label: 'Attachments',        icon: 'attach_file' },
  ];

  // ─── Inputs ───────────────────────────────────────────────────────────────

  /** Index of the currently active step (0-based). Two-way via (activeStepChange). */
  @Input() activeStep = 0;

  /** True when the user has made unsaved edits — guards the close button. */
  @Input() isDirty = false;

  /**
   * Validity flag for each step. Forward jump (via progress bar click) requires
   * all steps up to — but not including — the target to be valid.
   */
  @Input() stepValid: boolean[] = [false, false, false, false];

  /** True while a save/submit network call is in flight. */
  @Input() saving = false;

  /** Wizard modal title shown in the header bar. */
  @Input() title = 'New Load';

  /**
   * FN-749: When true, the wizard is editing an existing load.
   * - Step gating is relaxed (all steps jumpable)
   * - Title shows "Edit Load"
   * - Save uses PATCH instead of POST (handled by parent)
   */
  @Input() editMode = false;

  /** The load ID being edited (null for new loads). */
  @Input() editLoadId: string | null = null;

  // ─── Outputs ──────────────────────────────────────────────────────────────

  /** Emitted whenever the active step index changes. Use with banana-in-a-box: [(activeStep)]. */
  @Output() activeStepChange = new EventEmitter<number>();

  /** Emitted when the user requests Save (Cmd+S or Save button on last step). */
  @Output() save = new EventEmitter<void>();

  /** Emitted when the user requests Save & Create Another (Cmd+Shift+S). */
  @Output() saveAndNew = new EventEmitter<void>();

  /** Emitted when the wizard is dismissed (Esc or ✕, after unsaved-changes check). */
  @Output() cancel = new EventEmitter<void>();

  // ─── Internal UI state ────────────────────────────────────────────────────

  /** Controls visibility of the unsaved-changes confirmation dialog. */
  showUnsavedWarning = false;

  /** FN-765: unregister callback for the shortcut bindings owned by this component. */
  private _unregisterShortcuts: (() => void) | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private shortcuts: KeyboardShortcutsService,
  ) {}

  ngOnInit(): void {
    this._unregisterShortcuts = this.shortcuts.registerAll([
      {
        id: 'wizard.close',
        key: 'Escape',
        description: 'Close wizard (or dismiss unsaved-changes warning)',
        group: 'Load wizard',
        allowInInput: true,
        handler: () => {
          if (this.showUnsavedWarning) {
            this.dismissUnsavedWarning();
          } else {
            this.requestClose();
          }
        },
      },
      {
        id: 'wizard.saveAndNew',
        key: 's',
        ctrlOrCmd: true,
        shift: true,
        allowInInput: true,
        description: 'Save & create another',
        group: 'Load wizard',
        handler: () => this.saveAndNew.emit(),
      },
      {
        id: 'wizard.save',
        key: 's',
        ctrlOrCmd: true,
        allowInInput: true,
        description: 'Save load',
        group: 'Load wizard',
        handler: () => this.save.emit(),
      },
      {
        id: 'wizard.next',
        key: 'Enter',
        description: 'Next step',
        group: 'Load wizard',
        // Intentionally NOT allowInInput — let Enter submit fields / newlines first.
        handler: () => { if (!this.isLastStep) { this.next(); } },
      },
    ]);
  }

  ngOnDestroy(): void {
    if (this._unregisterShortcuts) {
      this._unregisterShortcuts();
      this._unregisterShortcuts = null;
    }
  }

  // ─── Step navigation ──────────────────────────────────────────────────────

  get isFirstStep(): boolean { return this.activeStep === 0; }
  get isLastStep():  boolean { return this.activeStep === this.STEPS.length - 1; }

  next(): void {
    if (!this.isLastStep) {
      this._setStep(this.activeStep + 1);
    }
  }

  back(): void {
    if (!this.isFirstStep) {
      this._setStep(this.activeStep - 1);
    }
  }

  /**
   * Jump directly to `index`.
   * - Backward jumps are always allowed.
   * - Forward jumps require all steps between current and target to be valid.
   */
  goToStep(index: number): void {
    if (index === this.activeStep) { return; }
    if (index < this.activeStep) {
      this._setStep(index);
      return;
    }
    if (this.canJumpTo(index)) {
      this._setStep(index);
    }
  }

  /**
   * Returns true when the user may click step `index` in the progress bar.
   * - Edit mode (FN-749): all steps freely jumpable
   * - Create mode: backward always, forward requires prior steps valid
   */
  canJumpTo(index: number): boolean {
    if (this.editMode) { return true; }
    if (index <= this.activeStep) { return true; }
    return this.stepValid.slice(0, index).every(Boolean);
  }

  /** True if the step at `index` has been completed (visited and valid). */
  isCompleted(index: number): boolean {
    return index < this.activeStep && !!this.stepValid[index];
  }

  private _setStep(index: number): void {
    this.activeStep = index;
    this.activeStepChange.emit(index);
    this.cdr.markForCheck();
  }

  // ─── Close / unsaved-changes guard ────────────────────────────────────────

  /** Called when the user clicks ✕ or presses Esc. */
  requestClose(): void {
    if (this.isDirty) {
      this.showUnsavedWarning = true;
      this.cdr.markForCheck();
    } else {
      this.cancel.emit();
    }
  }

  /** User confirmed "Yes, discard changes" in the warning dialog. */
  confirmDiscard(): void {
    this.showUnsavedWarning = false;
    this.cancel.emit();
  }

  /** User clicked "Keep editing" — dismiss the warning, stay in wizard. */
  dismissUnsavedWarning(): void {
    this.showUnsavedWarning = false;
    this.cdr.markForCheck();
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  // FN-765: moved from inline @HostListener to KeyboardShortcutsService so the
  // bindings appear in the global help modal (?) and unregister cleanly when
  // the wizard is closed.
}
