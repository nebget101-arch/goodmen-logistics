import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  SimpleChanges,
  ViewChildren
} from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';

export type QuickAddTab = 'search' | 'recent' | 'common';

export interface QuickAddPart {
  id: string;
  sku: string;
  name: string;
  default_cost?: number | null;
  on_hand_qty?: number | null;
}

export interface QuickAddEvent {
  part: QuickAddPart;
  qty: number;
}

interface CachedList {
  data: QuickAddPart[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 250;
const COMMON_WINDOW_DAYS = 90;
const ROW_LIMIT = 20;

@Component({
  selector: 'app-quick-add-panel',
  templateUrl: './quick-add-panel.component.html',
  styleUrls: ['./quick-add-panel.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuickAddPanelComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  @Input() locationId = '';
  @Input() qtyMultiplier = 1;
  @Input() disabled = false;

  @Output() addPart = new EventEmitter<QuickAddEvent>();

  @ViewChildren('rowBtn') rowButtons?: QueryList<ElementRef<HTMLButtonElement>>;

  activeTab: QuickAddTab = 'search';
  mobileExpanded = false;

  searchQuery = '';
  searchResults: QuickAddPart[] = [];
  searchLoading = false;
  searchTouched = false;

  recentResults: QuickAddPart[] = [];
  recentLoading = false;
  recentLoaded = false;

  commonResults: QuickAddPart[] = [];
  commonLoading = false;
  commonLoaded = false;

  private cache = new Map<string, CachedList>();
  private searchInput$ = new Subject<string>();
  private searchSub?: Subscription;
  private inflightRecent?: Subscription;
  private inflightCommon?: Subscription;

  /** Per-row qty input value, keyed by part.id. Defaults to 1 when not present. */
  private qtyByPart = new Map<string, number>();

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.searchSub = this.searchInput$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => {
          const trimmed = (term || '').trim();
          if (!trimmed) {
            this.searchLoading = false;
            this.searchResults = [];
            this.cdr.markForCheck();
            // Return an empty observable-like to keep the stream alive.
            return [];
          }
          this.searchLoading = true;
          this.cdr.markForCheck();
          return this.api.getParts({ search: trimmed, is_active: true });
        })
      )
      .subscribe({
        next: (res: any) => {
          this.searchResults = this.normalizeList(res);
          this.searchLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.searchResults = [];
          this.searchLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] && !changes['locationId'].firstChange) {
      // Location changed: invalidate location-keyed caches and reset loaded flags.
      this.cache.clear();
      this.recentResults = [];
      this.commonResults = [];
      this.recentLoaded = false;
      this.commonLoaded = false;
      if (this.activeTab === 'recent') this.loadRecent();
      if (this.activeTab === 'common') this.loadCommon();
    }
  }

  ngAfterViewInit(): void {
    // Default tab fetch on first render so users land on something useful.
    if (this.activeTab === 'recent') this.loadRecent();
    if (this.activeTab === 'common') this.loadCommon();
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    this.inflightRecent?.unsubscribe();
    this.inflightCommon?.unsubscribe();
  }

  selectTab(tab: QuickAddTab): void {
    if (tab === this.activeTab) return;
    this.activeTab = tab;
    if (tab === 'recent') this.loadRecent();
    if (tab === 'common') this.loadCommon();
  }

  onSearchInput(value: string): void {
    this.searchQuery = value;
    this.searchTouched = true;
    this.searchInput$.next(value);
  }

  toggleMobile(): void {
    this.mobileExpanded = !this.mobileExpanded;
  }

  onAddClick(part: QuickAddPart): void {
    if (this.disabled || !part) return;
    const userQty = Math.max(1, Math.floor(this.qtyByPart.get(part.id) ?? 1));
    const mult = Math.max(1, Number(this.qtyMultiplier) || 1);
    this.addPart.emit({ part, qty: userQty * mult });
  }

  /** Read the per-row qty value (defaults to 1) — used by the template. */
  getRowQty(id: string): number {
    return this.qtyByPart.get(id) ?? 1;
  }

  /** Sanitize and store the per-row qty input. Falls back to 1 for invalid values. */
  setRowQty(id: string, value: any): void {
    const n = Math.floor(Number(value));
    this.qtyByPart.set(id, Number.isFinite(n) && n >= 1 ? n : 1);
    this.cdr.markForCheck();
  }

  onRowKeydown(event: KeyboardEvent, index: number, list: QuickAddPart[]): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusRow(Math.min(index + 1, list.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusRow(Math.max(index - 1, 0));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onAddClick(list[index]);
    }
  }

  trackByPart = (_i: number, p: QuickAddPart) => p.id;

  /** Active list for the current tab — used by the template to wire keyboard nav. */
  get visibleList(): QuickAddPart[] {
    if (this.activeTab === 'search') return this.searchResults;
    if (this.activeTab === 'recent') return this.recentResults;
    return this.commonResults;
  }

  private focusRow(index: number): void {
    const buttons = this.rowButtons?.toArray() || [];
    if (index < 0 || index >= buttons.length) return;
    buttons[index].nativeElement.focus();
  }

  private loadRecent(): void {
    if (!this.locationId) {
      this.recentResults = [];
      this.recentLoaded = true;
      this.cdr.markForCheck();
      return;
    }
    const key = `recent:${this.locationId}`;
    const cached = this.readCache(key);
    if (cached) {
      this.recentResults = cached;
      this.recentLoaded = true;
      this.cdr.markForCheck();
      return;
    }
    this.recentLoading = true;
    this.cdr.markForCheck();
    this.inflightRecent?.unsubscribe();
    this.inflightRecent = this.api
      .getRecentPartsAtLocation(this.locationId, ROW_LIMIT)
      .subscribe({
        next: (res: any) => {
          const list = this.normalizeList(res);
          this.recentResults = list;
          this.writeCache(key, list);
          this.recentLoading = false;
          this.recentLoaded = true;
          this.cdr.markForCheck();
        },
        error: () => {
          this.recentResults = [];
          this.recentLoading = false;
          this.recentLoaded = true;
          this.cdr.markForCheck();
        }
      });
  }

  private loadCommon(): void {
    if (!this.locationId) {
      this.commonResults = [];
      this.commonLoaded = true;
      this.cdr.markForCheck();
      return;
    }
    const key = `common:${this.locationId}:${COMMON_WINDOW_DAYS}`;
    const cached = this.readCache(key);
    if (cached) {
      this.commonResults = cached;
      this.commonLoaded = true;
      this.cdr.markForCheck();
      return;
    }
    this.commonLoading = true;
    this.cdr.markForCheck();
    this.inflightCommon?.unsubscribe();
    this.inflightCommon = this.api
      .getCommonPartsAtLocation(this.locationId, COMMON_WINDOW_DAYS, ROW_LIMIT)
      .subscribe({
        next: (res: any) => {
          const list = this.normalizeList(res);
          this.commonResults = list;
          this.writeCache(key, list);
          this.commonLoading = false;
          this.commonLoaded = true;
          this.cdr.markForCheck();
        },
        error: () => {
          this.commonResults = [];
          this.commonLoading = false;
          this.commonLoaded = true;
          this.cdr.markForCheck();
        }
      });
  }

  private readCache(key: string): QuickAddPart[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private writeCache(key: string, data: QuickAddPart[]): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private normalizeList(res: any): QuickAddPart[] {
    const raw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    return raw.map((p: any) => ({
      id: p.id,
      sku: p.sku ?? '',
      name: p.name ?? '',
      default_cost: p.default_cost ?? p.defaultCost ?? null,
      on_hand_qty:
        p.on_hand_qty ?? p.onHandQty ?? p.qty_on_hand ?? p.qtyOnHand ?? null
    }));
  }
}
