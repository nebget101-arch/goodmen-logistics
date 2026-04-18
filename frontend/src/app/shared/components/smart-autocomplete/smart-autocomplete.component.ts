import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ElementRef,
  HostListener,
  TemplateRef,
  ViewChild
} from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-smart-autocomplete',
  templateUrl: './smart-autocomplete.component.html',
  styleUrls: ['./smart-autocomplete.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SmartAutocompleteComponent implements OnDestroy, OnChanges {
  /** Full list of items to search through. */
  @Input() items: Record<string, unknown>[] = [];

  /** Field name used for display text in the input and dropdown. */
  @Input() displayField = 'name';

  /** Array of field names to search across. */
  @Input() searchFields: string[] = ['name'];

  /** Placeholder text for the input. */
  @Input() placeholder = 'Search...';

  /** The currently selected value (the full item object). */
  @Input() value: Record<string, unknown> | null = null;

  /** Maximum results to display in the dropdown. */
  @Input() maxResults = 50;

  /** Recently used items shown in a separate section. */
  @Input() recentItems: Record<string, unknown>[] = [];

  /** Optional custom template for rendering each item. */
  @Input() itemTemplate: TemplateRef<unknown> | null = null;

  /** Whether data is still loading. Shows a spinner instead of results. */
  @Input() loading = false;

  /** Emits when the user selects an item. */
  @Output() valueChange = new EventEmitter<Record<string, unknown>>();

  /** Emits the current search string (debounced) for external consumers. */
  @Output() search = new EventEmitter<string>();

  @ViewChild('inputEl', { static: true }) inputEl!: ElementRef<HTMLInputElement>;

  searchText = '';
  filteredItems: Record<string, unknown>[] = [];
  filteredRecent: Record<string, unknown>[] = [];
  showDropdown = false;
  totalMatches = 0;
  activeIndex = -1;

  private searchSubject = new Subject<string>();
  private searchSub: Subscription;

  constructor(
    private elRef: ElementRef,
    private cdr: ChangeDetectorRef
  ) {
    this.searchSub = this.searchSubject.pipe(
      debounceTime(150),
      distinctUntilChanged()
    ).subscribe(term => {
      this.filterItems(term);
      this.search.emit(term);
      this.cdr.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.value) {
      this.searchText = this.getDisplayValue(this.value);
    }
    if (changes['items'] && !changes['items'].firstChange) {
      if (this.showDropdown && this.searchText) {
        this.filterItems(this.searchText);
      }
    }
  }

  ngOnDestroy(): void {
    this.searchSub.unsubscribe();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.closeDropdown();
    }
  }

  onInputChange(text: string): void {
    this.searchText = text;
    this.activeIndex = -1;
    if (!text) {
      this.filteredItems = [];
      this.filteredRecent = [];
      this.totalMatches = 0;
      this.showDropdown = false;
      this.cdr.markForCheck();
      return;
    }
    this.showDropdown = true;
    this.searchSubject.next(text);
  }

  onInputFocus(): void {
    if (this.searchText) {
      this.filterItems(this.searchText);
      this.showDropdown = true;
      this.cdr.markForCheck();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.showDropdown) return;

    const totalVisible = this.filteredRecent.length + this.filteredItems.length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, totalVisible - 1);
        this.cdr.markForCheck();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, -1);
        this.cdr.markForCheck();
        break;
      case 'Enter':
        event.preventDefault();
        if (this.activeIndex >= 0) {
          const item = this.getItemAtIndex(this.activeIndex);
          if (item) this.selectItem(item);
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.closeDropdown();
        break;
    }
  }

  selectItem(item: Record<string, unknown>): void {
    this.value = item;
    this.searchText = this.getDisplayValue(item);
    this.closeDropdown();
    this.valueChange.emit(item);
  }

  getDisplayValue(item: Record<string, unknown> | null): string {
    if (!item) return '';
    const val = item[this.displayField];
    return val != null ? String(val) : '';
  }

  isActive(sectionIndex: number): boolean {
    return this.activeIndex === sectionIndex;
  }

  trackByIndex(_index: number): number {
    return _index;
  }

  trackById(_index: number, item: Record<string, unknown>): unknown {
    return item['id'] ?? _index;
  }

  // ── Private helpers ──

  private filterItems(term: string): void {
    const lower = term.toLowerCase();

    // Filter recent items
    this.filteredRecent = this.recentItems.filter(item =>
      this.matchesSearch(item, lower)
    );

    // Filter all items
    const recentIds = new Set(this.filteredRecent.map(r => r['id']));
    const allMatches = this.items.filter(item =>
      !recentIds.has(item['id']) && this.matchesSearch(item, lower)
    );

    this.totalMatches = allMatches.length + this.filteredRecent.length;
    this.filteredItems = allMatches.slice(0, this.maxResults);
  }

  private matchesSearch(item: Record<string, unknown>, lowerTerm: string): boolean {
    return this.searchFields.some(field => {
      const fieldValue = item[field];
      if (fieldValue == null) return false;
      return String(fieldValue).toLowerCase().includes(lowerTerm);
    });
  }

  private getItemAtIndex(index: number): Record<string, unknown> | null {
    if (index < this.filteredRecent.length) {
      return this.filteredRecent[index];
    }
    const adjustedIndex = index - this.filteredRecent.length;
    return this.filteredItems[adjustedIndex] ?? null;
  }

  private closeDropdown(): void {
    this.showDropdown = false;
    this.activeIndex = -1;
    this.cdr.markForCheck();
  }
}
