import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  Output
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { TriageRecord, TriageService } from '../../../../services/triage.service';

@Component({
  selector: 'app-override-modal',
  template: `
    <div class="modal-backdrop" (mousedown)="onBackdropClick($event)">
      <div class="override-modal" (mousedown)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="override-modal-title">
        <div class="override-modal__header">
          <h2 id="override-modal-title" class="override-modal__title">Override AI Triage</h2>
          <button type="button" class="override-modal__close" (click)="cancel()" aria-label="Close">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="override-modal__body">
          <p class="override-modal__hint-label">Optional: provide context for re-triage</p>
          <textarea
            class="override-modal__textarea"
            [(ngModel)]="hint"
            placeholder="e.g. Driver reported smoke — may be engine fire, not flat tyre"
            rows="4"
            [disabled]="loading"
            aria-label="Override hint"
          ></textarea>
          <p class="override-modal__error" *ngIf="errorMessage" role="alert">{{ errorMessage }}</p>
        </div>
        <div class="override-modal__footer">
          <button type="button" class="override-modal__btn override-modal__btn--secondary" (click)="cancel()" [disabled]="loading">
            Cancel
          </button>
          <button type="button" class="override-modal__btn override-modal__btn--primary" (click)="submit()" [disabled]="loading">
            <span *ngIf="!loading">Re-triage</span>
            <span *ngIf="loading" class="override-modal__spinner" aria-label="Loading"></span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .override-modal {
      background: var(--fn-surface, #1e2536);
      border: 1px solid var(--fn-border, rgba(255,255,255,0.08));
      border-radius: 12px;
      width: min(480px, 90vw);
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .override-modal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--fn-border, rgba(255,255,255,0.08));
    }
    .override-modal__title {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--fn-text-primary, #e2e8f0);
    }
    .override-modal__close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--fn-text-muted, #94a3b8);
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 4px;
    }
    .override-modal__close:hover { color: var(--fn-text-primary, #e2e8f0); }
    .override-modal__body {
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .override-modal__hint-label {
      margin: 0;
      font-size: 13px;
      color: var(--fn-text-muted, #94a3b8);
    }
    .override-modal__textarea {
      width: 100%;
      box-sizing: border-box;
      background: var(--fn-input-bg, rgba(255,255,255,0.05));
      border: 1px solid var(--fn-border, rgba(255,255,255,0.12));
      border-radius: 6px;
      color: var(--fn-text-primary, #e2e8f0);
      font-size: 14px;
      padding: 10px 12px;
      resize: vertical;
    }
    .override-modal__textarea:disabled { opacity: 0.6; cursor: not-allowed; }
    .override-modal__error {
      margin: 0;
      font-size: 13px;
      color: var(--fn-danger, #f87171);
    }
    .override-modal__footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 24px 20px;
      border-top: 1px solid var(--fn-border, rgba(255,255,255,0.08));
    }
    .override-modal__btn {
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
    }
    .override-modal__btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .override-modal__btn--secondary {
      background: var(--fn-surface-raised, rgba(255,255,255,0.06));
      color: var(--fn-text-primary, #e2e8f0);
      border: 1px solid var(--fn-border, rgba(255,255,255,0.1));
    }
    .override-modal__btn--primary {
      background: var(--fn-accent, #3b82f6);
      color: #fff;
      min-width: 88px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .override-modal__spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      display: inline-block;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class OverrideModalComponent implements OnDestroy {
  @Input() incidentId!: string;
  @Output() overrideComplete = new EventEmitter<TriageRecord>();
  @Output() cancelled = new EventEmitter<void>();

  hint = '';
  loading = false;
  errorMessage = '';

  private destroy$ = new Subject<void>();

  constructor(private triageService: TriageService) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.loading) return;
    this.loading = true;
    this.errorMessage = '';
    this.triageService.overrideTriage(this.incidentId, { hint: this.hint || undefined })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (record) => {
          this.loading = false;
          this.overrideComplete.emit(record);
        },
        error: () => {
          this.loading = false;
          this.errorMessage = 'Re-triage failed. Please try again.';
        }
      });
  }

  cancel(): void {
    if (this.loading) return;
    this.cancelled.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (!this.loading) this.cancelled.emit();
  }
}
