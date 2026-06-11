import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-feedback-form',
  template: `
    <form class="feedback-form" (ngSubmit)="submit()" #feedbackForm="ngForm" novalidate>
      <h3 class="form-heading">
        <span class="material-icons heading-icon" aria-hidden="true">rate_review</span>
        How was your experience?
      </h3>

      <div class="rating-row" role="group" aria-label="Star rating">
        <button
          *ngFor="let star of stars"
          type="button"
          class="star-btn"
          [class.active]="(rating ?? 0) >= star"
          (click)="setRating(star)"
          [attr.aria-label]="star + ' star' + (star === 1 ? '' : 's')"
          [attr.aria-pressed]="(rating ?? 0) >= star"
        >
          <span class="material-icons">{{ (rating ?? 0) >= star ? 'star' : 'star_border' }}</span>
        </button>
      </div>

      <div class="field-group">
        <label class="field-label" for="feedback-text">Your comments</label>
        <textarea
          id="feedback-text"
          name="feedbackText"
          [(ngModel)]="feedbackText"
          class="feedback-textarea"
          rows="4"
          placeholder="Tell us what went well or how we can improve…"
          required
          minlength="5"
          maxlength="2000"
          aria-required="true"
          [attr.aria-describedby]="error ? 'feedback-error' : null"
        ></textarea>
        <div class="char-count" aria-live="polite">{{ feedbackText.length }}/2000</div>
      </div>

      <div *ngIf="error" id="feedback-error" class="form-error" role="alert">
        <span class="material-icons" aria-hidden="true">error_outline</span>
        {{ error }}
      </div>

      <button
        type="submit"
        class="submit-btn"
        [disabled]="submitting || feedbackText.trim().length < 5"
        [attr.aria-busy]="submitting"
      >
        <span class="material-icons btn-icon" aria-hidden="true">
          {{ submitting ? 'hourglass_empty' : 'send' }}
        </span>
        {{ submitting ? 'Submitting…' : 'Submit Feedback' }}
      </button>
    </form>
  `,
  styles: [`
    .feedback-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-heading {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #f1f5f9;
    }
    .heading-icon { font-size: 20px; color: #a78bfa; }

    .rating-row {
      display: flex;
      gap: 4px;
    }
    .star-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: #475569;
      transition: color 0.12s, transform 0.1s;
      line-height: 1;
    }
    .star-btn .material-icons { font-size: 28px; }
    .star-btn.active { color: #fbbf24; }
    .star-btn:hover { transform: scale(1.1); }
    .star-btn:focus-visible {
      outline: 2px solid #38bdf8;
      outline-offset: 2px;
      border-radius: 4px;
    }

    .field-group { display: flex; flex-direction: column; gap: 6px; }
    .field-label {
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }

    .feedback-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: rgba(15, 23, 42, 0.55);
      color: #e5e7eb;
      font-size: 14px;
      font-family: inherit;
      resize: vertical;
      transition: border-color 0.15s;
    }
    .feedback-textarea:focus {
      outline: none;
      border-color: rgba(56, 189, 248, 0.6);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
    }
    .feedback-textarea::placeholder { color: #475569; }

    .char-count {
      font-size: 12px;
      color: #475569;
      text-align: right;
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(127, 29, 29, 0.35);
      border: 1px solid rgba(248, 113, 113, 0.4);
      color: #fca5a5;
      font-size: 13px;
    }
    .form-error .material-icons { font-size: 16px; }

    .submit-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      align-self: flex-start;
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
    }
    .submit-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-icon { font-size: 18px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackFormComponent {
  @Input() incidentId = '';
  @Output() submitted = new EventEmitter<void>();

  readonly stars = [1, 2, 3, 4, 5];

  feedbackText = '';
  rating: number | null = null;
  submitting = false;
  error = '';

  constructor(private apiService: ApiService, private cdr: ChangeDetectorRef) {}

  setRating(value: number): void {
    this.rating = this.rating === value ? null : value;
    this.cdr.markForCheck();
  }

  submit(): void {
    if (this.feedbackText.trim().length < 5 || !this.incidentId) return;

    this.submitting = true;
    this.error = '';
    this.cdr.markForCheck();

    this.apiService.updateSafetyIncident(this.incidentId, {
      driver_feedback: this.feedbackText.trim(),
      driver_rating: this.rating,
    }).subscribe({
      next: () => {
        this.submitting = false;
        this.submitted.emit();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to submit feedback. Please try again.';
        this.submitting = false;
        this.cdr.markForCheck();
      },
    });
  }
}
