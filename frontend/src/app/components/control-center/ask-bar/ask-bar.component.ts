import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';

import {
  AskAnswer,
  AskAnswerChart,
  AskAnswerMetric,
  AskAnswerTable,
  AskAnswerText,
  AskBriefingContext,
  AskService,
  AskSuccessResponse,
} from '../../../services/ask.service';

@Component({
  selector: 'app-ask-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ask-bar.component.html',
  styleUrls: ['./ask-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskBarComponent implements AfterViewInit, OnDestroy {
  @ViewChild('askInput') askInput?: ElementRef<HTMLInputElement>;

  prompt = '';
  loading = false;
  response: AskSuccessResponse | null = null;
  errorMessage: string | null = null;
  lastSubmittedPrompt = '';
  announceMessage = '';

  briefingContext: AskBriefingContext | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly askService: AskService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngAfterViewInit(): void {
    this.focusInput();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === '/' && !this.isFocusInTextField(event.target)) {
      event.preventDefault();
      this.focusInput();
      return;
    }

    if (event.key === 'Escape' && (this.response || this.errorMessage)) {
      this.closeResults();
    }
  }

  submit(): void {
    const trimmed = this.prompt.trim();
    if (!trimmed || this.loading) return;

    this.loading = true;
    this.errorMessage = null;
    this.response = null;
    this.lastSubmittedPrompt = trimmed;
    this.announceMessage = 'Asking FleetNeuron…';
    this.cdr.markForCheck();

    this.askService
      .ask({ prompt: trimmed, briefingContext: this.briefingContext })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.response = data;
          this.loading = false;
          this.announceMessage = this.summarizeForAnnounce(data);
          this.cdr.markForCheck();
        },
        error: (err: unknown) => {
          this.errorMessage = this.extractErrorMessage(err);
          this.loading = false;
          this.announceMessage = this.errorMessage;
          this.cdr.markForCheck();
        },
      });
  }

  retry(): void {
    if (!this.lastSubmittedPrompt || this.loading) return;
    this.prompt = this.lastSubmittedPrompt;
    this.submit();
  }

  closeResults(): void {
    this.response = null;
    this.errorMessage = null;
    this.announceMessage = '';
    this.cdr.markForCheck();
    this.focusInput();
  }

  asTextAnswer(answer: AskAnswer): AskAnswerText | null {
    return answer.kind === 'text' ? answer : null;
  }

  asTableAnswer(answer: AskAnswer): AskAnswerTable | null {
    return answer.kind === 'table' ? answer : null;
  }

  asChartAnswer(answer: AskAnswer): AskAnswerChart | null {
    return answer.kind === 'chart' ? answer : null;
  }

  asMetricAnswer(answer: AskAnswer): AskAnswerMetric | null {
    return answer.kind === 'metric' ? answer : null;
  }

  chartBarWidth(answer: AskAnswerChart, value: number): string {
    const max = answer.series.reduce((m, s) => (s.value > m ? s.value : m), 0);
    if (!max) return '0%';
    return `${Math.max(2, Math.round((value / max) * 100))}%`;
  }

  intentLabel(intent: string | undefined): string {
    if (!intent) return 'General';
    const map: Record<string, string> = {
      loads: 'Loads',
      drivers: 'Drivers',
      vehicles: 'Vehicles',
      generic: 'General',
    };
    return map[intent] || intent;
  }

  private focusInput(): void {
    const el = this.askInput?.nativeElement;
    if (el && document.activeElement !== el) {
      el.focus();
      el.select();
    }
  }

  private isFocusInTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return target.isContentEditable === true;
  }

  private summarizeForAnnounce(data: AskSuccessResponse): string {
    const headline = data.answer?.headline?.trim();
    if (headline) {
      return `FleetNeuron answered: ${headline}`;
    }
    return 'FleetNeuron returned an answer.';
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === 'object' && typeof body.error === 'string') {
        return body.error;
      }
      if (err.status === 0) {
        return 'FleetNeuron is unreachable. Check your connection and try again.';
      }
      if (err.status >= 500) {
        return 'FleetNeuron is temporarily unavailable. Try again in a moment.';
      }
    }
    return 'FleetNeuron could not answer right now. Try again in a moment.';
  }
}
