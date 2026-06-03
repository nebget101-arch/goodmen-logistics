import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Observable, Subject, Subscription, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { MasterEntity } from '../../../services/manufacturers.service';

export interface MasterTypeaheadValue {
  id: number | null;
  name: string;
}

/**
 * Remote-search typeahead for master entities (manufacturer, vendor, …).
 *
 * Inputs are passed by reference (functions + plain value object) — never bind
 * a getter for `searchFn`/`createFn`/`value` from the parent (FN-317 RCA: a
 * getter creates a fresh reference every change-detection cycle and traps the
 * OnPush child in an infinite re-render).
 */
@Component({
  selector: 'app-master-typeahead',
  templateUrl: './master-typeahead.component.html',
  styleUrls: ['./master-typeahead.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MasterTypeaheadComponent implements OnInit, OnChanges, OnDestroy {
  /** Singular label used in placeholder + "Create new …" affordance (e.g. "manufacturer"). */
  @Input() entityLabel = 'item';

  /** Optional id attached to the inner <input> so an external <label> can target it. */
  @Input() inputId = '';

  /** Placeholder text for the input. Falls back to "Search {entityLabel}…". */
  @Input() placeholder = '';

  /** Initial / external value. Pass `{id, name}` for an FK-backed selection or `{id: null, name}` for legacy text. */
  @Input() value: MasterTypeaheadValue | null = null;

  /** Whether the input is disabled. */
  @Input() disabled = false;

  /** Function that returns matching rows for a search term. Bound once by the parent. */
  @Input() searchFn: (q: string) => Observable<MasterEntity[]> = () => of([]);

  /** Function that creates a new master row by name. Bound once by the parent. */
  @Input() createFn: (name: string) => Observable<MasterEntity> = () =>
    of({ id: 0, name: '' } as MasterEntity);

  /** Emits whenever the selection changes (pick, create, clear). */
  @Output() valueChange = new EventEmitter<MasterTypeaheadValue>();

  @ViewChild('inputEl', { static: true }) inputEl!: ElementRef<HTMLInputElement>;

  inputText = '';
  results: MasterEntity[] = [];
  loading = false;
  creating = false;
  error: string | null = null;
  showDropdown = false;
  /** -1 = none, 0..results.length-1 = result row, results.length = "Create new" row. */
  activeIndex = -1;
  /** True after first non-empty search response, used to differentiate "haven't searched" from "searched and got 0". */
  hasSearched = false;

  private readonly searchSubject = new Subject<string>();
  private searchSub: Subscription | null = null;

  constructor(private readonly elRef: ElementRef, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.searchSub = this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          this.loading = !!term.trim();
          this.error = null;
          this.cdr.markForCheck();
        }),
        switchMap((term) => {
          if (!term.trim()) {
            this.hasSearched = false;
            return of<MasterEntity[]>([]);
          }
          return this.searchFn(term).pipe(
            catchError((err) => {
              this.error = this.toMessage(err) || `Could not search ${this.entityLabel}s`;
              return of<MasterEntity[]>([]);
            })
          );
        })
      )
      .subscribe((rows) => {
        this.results = rows;
        this.loading = false;
        this.activeIndex = -1;
        if (this.inputText.trim() && !this.error) {
          this.hasSearched = true;
        }
        this.cdr.markForCheck();
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.inputText = this.value?.name ?? '';
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target as Node)) {
      this.closeDropdown();
    }
  }

  onInput(event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.inputText = text;
    // Free typing means the prior FK no longer applies; surface the raw text
    // so the parent form keeps the legacy text in sync until a pick/create.
    this.value = { id: null, name: text };
    this.valueChange.emit(this.value);
    this.showDropdown = true;
    this.error = null;
    if (!text.trim()) {
      this.results = [];
      this.hasSearched = false;
    }
    this.searchSubject.next(text);
    this.cdr.markForCheck();
  }

  onFocus(): void {
    if (this.inputText.trim() && (this.results.length || this.error || this.hasSearched)) {
      this.showDropdown = true;
      this.cdr.markForCheck();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const showCreate = this.canCreate();
    const lastIndex = this.results.length - 1 + (showCreate ? 1 : 0);
    switch (event.key) {
      case 'ArrowDown':
        if (!this.showDropdown) {
          this.showDropdown = true;
        }
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, lastIndex);
        this.cdr.markForCheck();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, -1);
        this.cdr.markForCheck();
        break;
      case 'Enter':
        if (!this.showDropdown) return;
        event.preventDefault();
        if (this.activeIndex >= 0 && this.activeIndex < this.results.length) {
          this.selectResult(this.results[this.activeIndex]);
        } else if (showCreate && this.activeIndex === this.results.length) {
          this.createNew();
        }
        break;
      case 'Escape':
        if (this.showDropdown) {
          event.preventDefault();
          this.closeDropdown();
        }
        break;
    }
  }

  selectResult(row: MasterEntity): void {
    const next: MasterTypeaheadValue = { id: row.id, name: row.name };
    this.value = next;
    this.inputText = row.name;
    this.closeDropdown();
    this.valueChange.emit(next);
  }

  createNew(): void {
    const trimmed = this.inputText.trim();
    if (!trimmed || this.creating) return;
    this.creating = true;
    this.error = null;
    this.cdr.markForCheck();
    this.createFn(trimmed)
      .pipe(
        catchError((err) => {
          this.error = this.toMessage(err) || `Could not create ${this.entityLabel}`;
          return of<MasterEntity | null>(null);
        })
      )
      .subscribe((row) => {
        this.creating = false;
        if (row && row.id) {
          this.selectResult(row);
        }
        this.cdr.markForCheck();
      });
  }

  retry(): void {
    if (!this.inputText.trim()) return;
    // Re-emit the same term — distinctUntilChanged would normally swallow it,
    // so prepend a no-op character variation that the trim discards.
    this.searchSubject.next(this.inputText + ' ');
    this.searchSubject.next(this.inputText);
  }

  /** Whether the "Create new …" affordance should appear. */
  canCreate(): boolean {
    const trimmed = this.inputText.trim();
    if (!trimmed || this.loading || this.creating || this.error) return false;
    const lower = trimmed.toLowerCase();
    return !this.results.some((r) => (r.name || '').toLowerCase() === lower);
  }

  trackById(_index: number, item: MasterEntity): number {
    return item.id;
  }

  private closeDropdown(): void {
    this.showDropdown = false;
    this.activeIndex = -1;
    this.cdr.markForCheck();
  }

  private toMessage(err: unknown): string {
    const e = err as { error?: { error?: string }; message?: string } | null;
    return e?.error?.error || e?.message || '';
  }
}
