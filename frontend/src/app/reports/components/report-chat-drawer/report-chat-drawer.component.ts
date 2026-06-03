import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import {
  ReportChatMessage,
  ReportChatRequest,
  ReportChatResponse,
  ReportFilters
} from '../../reports.models';
import { ReportsService } from '../../services/reports.service';

const MAX_DATA_ROWS = 100;

@Component({
  selector: 'app-report-chat-drawer',
  templateUrl: './report-chat-drawer.component.html',
  styleUrls: ['./report-chat-drawer.component.scss']
})
export class ReportChatDrawerComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() open = false;
  @Input() reportKey = '';
  @Input() reportTitle = '';
  @Input() filters: ReportFilters = {};
  @Input() data: Array<Record<string, unknown>> = [];
  @Input() summary: Record<string, unknown> = {};

  @Output() closed = new EventEmitter<void>();

  @ViewChild('drawerRoot') drawerRoot?: ElementRef<HTMLElement>;
  @ViewChild('messageInput') messageInput?: ElementRef<HTMLTextAreaElement>;

  messages: ReportChatMessage[] = [];
  inputValue = '';
  isSending = false;
  error = '';

  private readonly destroy$ = new Subject<void>();
  private previouslyFocused: HTMLElement | null = null;

  constructor(private reportsService: ReportsService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['reportKey'] && !changes['reportKey'].firstChange) {
      const prev = changes['reportKey'].previousValue;
      const next = changes['reportKey'].currentValue;
      if (prev !== next) {
        this.resetConversation();
      }
    }
    if (changes['open']) {
      const wasOpen = !!changes['open'].previousValue;
      const isOpen = !!changes['open'].currentValue;
      if (!wasOpen && isOpen) {
        this.previouslyFocused = (document.activeElement as HTMLElement) || null;
        setTimeout(() => this.focusInput(), 0);
      } else if (wasOpen && !isOpen) {
        this.restoreFocus();
      }
    }
  }

  ngAfterViewInit(): void {
    if (this.open) {
      this.focusInput();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  resetConversation(): void {
    this.messages = [];
    this.inputValue = '';
    this.error = '';
    this.isSending = false;
  }

  requestClose(): void {
    if (!this.open) return;
    this.closed.emit();
  }

  onOverlayClick(): void {
    this.requestClose();
  }

  onInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    const text = (this.inputValue || '').trim();
    if (!text || this.isSending) return;
    this.error = '';
    const userMsg: ReportChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };
    const history = [...this.messages];
    this.messages = [...history, userMsg];
    this.inputValue = '';
    this.isSending = true;

    const payload: ReportChatRequest = {
      reportKey: this.reportKey,
      filters: this.filters || {},
      data: this.truncateData(this.data || []),
      history,
      message: text,
      summary: this.summary || {}
    };

    this.reportsService.chatWithReport(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (resp: ReportChatResponse) => {
          const assistantMsg: ReportChatMessage = {
            role: 'assistant',
            content: resp?.reply || '',
            timestamp: resp?.generatedAt || new Date().toISOString()
          };
          this.messages = [...this.messages, assistantMsg];
          this.isSending = false;
          setTimeout(() => this.focusInput(), 0);
        },
        error: (err) => {
          this.isSending = false;
          this.error = err?.error?.error || err?.error?.message || 'Chat request failed. Try again.';
        }
      });
  }

  trackByIndex(index: number): number {
    return index;
  }

  /** Defensive client-side truncation: keep first N rows + a small computed summary. */
  private truncateData(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    if (!Array.isArray(rows) || rows.length <= MAX_DATA_ROWS) return rows || [];
    return rows.slice(0, MAX_DATA_ROWS);
  }

  // ── A11y: keyboard handling on the drawer ──────────────────────────────
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.requestClose();
      return;
    }
    if (event.key === 'Tab') {
      this.handleFocusTrap(event);
    }
  }

  private handleFocusTrap(event: KeyboardEvent): void {
    const root = this.drawerRoot?.nativeElement;
    if (!root) return;
    const focusables = this.getFocusable(root);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  private getFocusable(root: HTMLElement): HTMLElement[] {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    return Array.from(root.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  private focusInput(): void {
    this.messageInput?.nativeElement?.focus();
  }

  private restoreFocus(): void {
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (target && typeof target.focus === 'function') {
      try { target.focus(); } catch { /* ignore */ }
    }
  }
}
