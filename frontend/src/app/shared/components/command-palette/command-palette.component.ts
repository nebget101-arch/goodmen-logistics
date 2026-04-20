import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { CommandPaletteService } from '../../services/command-palette.service';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { AccessControlService } from '../../../services/access-control.service';
import { NAV_TOP_LINKS, NAV_SECTIONS, NavLink } from '../../../config/nav.config';

interface PaletteItem {
  group: 'recent' | 'loads' | 'search' | 'actions' | 'filters' | 'nav';
  groupLabel: string;
  icon: string;
  label: string;
  hint?: string;
  activate: () => void;
}

interface NlqLoadResult {
  id: string;
  load_number?: string;
  loadNumber?: string;
  broker_name?: string;
  brokerName?: string;
  driver_name?: string;
  driverName?: string;
  status?: string;
  billing_status?: string;
  billingStatus?: string;
  rate?: number;
}

interface NlqResponse {
  filters?: Record<string, unknown>;
  loads?: NlqLoadResult[];
  fallback?: boolean;
}

/**
 * FN-802 — CommandPalette
 *
 * App-wide Cmd+K palette. Renders four result groups (Matching Loads, Actions,
 * Smart Filters, Navigation), keyboard-navigated, with a recent-searches list
 * shown when the input is empty. Calls `/api/loads/search/nlq` on submit and
 * tolerates the endpoint being unavailable (FN-801) — when the call fails,
 * the palette still works for navigation/actions.
 *
 * Mounted once at app root; the Cmd+K binding is registered with
 * KeyboardShortcutsService (FN-765) so it appears in the help modal and
 * doesn't double-bind with another listener.
 */
@Component({
  selector: 'app-command-palette',
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent implements OnInit, OnDestroy, AfterViewChecked {

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  open = false;
  query = '';
  loading = false;
  selectedIndex = 0;

  recentSearches: string[] = [];
  nlqLoads: NlqLoadResult[] = [];
  nlqFallback = false;
  /** The query the current `nlqLoads` belong to — lets us hide stale results once the user keeps typing. */
  private nlqQuery = '';

  /** Flattened list of items currently visible (in render order). */
  visibleItems: PaletteItem[] = [];

  private allActions: PaletteItem[] = [];
  private allSmartFilters: PaletteItem[] = [];
  private allNavLinks: PaletteItem[] = [];
  private destroy$ = new Subject<void>();
  private shouldFocusInput = false;
  private shortcutOff?: () => void;

  constructor(
    private palette: CommandPaletteService,
    private shortcuts: KeyboardShortcutsService,
    private access: AccessControlService,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.shortcutOff = this.shortcuts.register({
      id: 'global.commandPalette',
      key: 'k',
      ctrlOrCmd: true,
      allowInInput: true,
      description: 'Open command palette',
      group: 'Global',
      handler: () => this.palette.toggle(),
    });

    this.buildStaticItems();

    this.palette.open$.pipe(takeUntil(this.destroy$)).subscribe(open => {
      this.open = open;
      if (open) {
        this.query = '';
        this.nlqLoads = [];
        this.nlqQuery = '';
        this.nlqFallback = false;
        this.loading = false;
        this.recentSearches = this.palette.getRecentSearches();
        this.shouldFocusInput = true;
      }
      this.rebuildVisibleItems();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    if (this.shortcutOff) { this.shortcutOff(); }
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewChecked(): void {
    if (this.shouldFocusInput && this.searchInput) {
      this.searchInput.nativeElement.focus();
      this.searchInput.nativeElement.select();
      this.shouldFocusInput = false;
    }
  }

  // ─── Input handlers ──────────────────────────────────────────────────────────

  onQueryChange(value: string): void {
    this.query = value;
    // Typing past an NLQ result invalidates it.
    if (value.trim().toLowerCase() !== this.nlqQuery.toLowerCase()) {
      this.nlqLoads = [];
      this.nlqFallback = false;
    }
    this.selectedIndex = 0;
    this.rebuildVisibleItems();
  }

  close(): void {
    this.palette.close();
  }

  onBackdropClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target?.classList?.contains('cp-backdrop')) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.open) {
      event.stopPropagation();
      event.preventDefault();
      this.close();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (!this.visibleItems.length) { return; }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.visibleItems.length;
      this.cdr.markForCheck();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.visibleItems.length) % this.visibleItems.length;
      this.cdr.markForCheck();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.activateItem(this.visibleItems[this.selectedIndex]);
    }
  }

  activateItem(item: PaletteItem | undefined): void {
    if (!item) { return; }
    item.activate();
  }

  // ─── Group label helper for the template ────────────────────────────────────

  /** Returns true when this item is the first of its group (so the template can render a header). */
  isFirstOfGroup(index: number): boolean {
    if (index === 0) { return true; }
    return this.visibleItems[index].group !== this.visibleItems[index - 1].group;
  }

  trackByIndex(index: number): number {
    return index;
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private buildStaticItems(): void {
    this.allActions = [
      {
        group: 'actions', groupLabel: 'Actions', icon: 'add_circle',
        label: 'New load', hint: 'Open the loads list to start a new load',
        activate: () => this.navigate(['/loads']),
      },
      {
        group: 'actions', groupLabel: 'Actions', icon: 'refresh',
        label: 'Open dashboard', hint: 'Jump to the main dashboard',
        activate: () => this.navigate(['/dashboard']),
      },
      {
        group: 'actions', groupLabel: 'Actions', icon: 'keyboard',
        label: 'Show keyboard shortcuts', hint: 'Opens the shortcuts help overlay',
        activate: () => { this.close(); this.shortcuts.openHelp(); },
      },
    ];

    this.allSmartFilters = [
      {
        group: 'filters', groupLabel: 'Smart Filters', icon: 'flag',
        label: 'Loads needing review', hint: 'Show loads with unresolved issues',
        activate: () => this.navigate(['/loads'], { needsReview: 'true' }),
      },
      {
        group: 'filters', groupLabel: 'Smart Filters', icon: 'local_shipping',
        label: 'Loads in transit',
        activate: () => this.navigate(['/loads'], { status: 'IN_TRANSIT' }),
      },
      {
        group: 'filters', groupLabel: 'Smart Filters', icon: 'task_alt',
        label: 'Loads delivered today',
        activate: () => this.navigate(['/loads'], { status: 'DELIVERED', dateFrom: this.todayIso() }),
      },
      {
        group: 'filters', groupLabel: 'Smart Filters', icon: 'paid',
        label: 'Loads pending billing',
        activate: () => this.navigate(['/loads'], { billingStatus: 'PENDING' }),
      },
    ];

    const navLinks: NavLink[] = [
      ...NAV_TOP_LINKS,
      ...NAV_SECTIONS.flatMap(s => s.children),
    ];
    this.allNavLinks = navLinks
      .filter(link => this.canSeeNavLink(link))
      .map(link => ({
        group: 'nav' as const,
        groupLabel: 'Navigation',
        icon: link.icon || 'arrow_forward',
        label: link.label,
        hint: link.path,
        activate: () => this.navigate([link.path]),
      }));
  }

  private canSeeNavLink(link: NavLink): boolean {
    try {
      if (link.featureFlag && !this.access.hasFeatureAccess(link.featureFlag)) { return false; }
      if (!this.access.canSee(link.tab)) { return false; }
      if (link.roles?.length) { return this.access.hasAnyRole(link.roles) && this.access.canAccessUrl(link.path); }
      return this.access.canAccessUrl(link.path);
    } catch {
      // Access service may not be loaded yet; default to showing top-level entries.
      return true;
    }
  }

  private rebuildVisibleItems(): void {
    const items: PaletteItem[] = [];
    const trimmed = this.query.trim();

    if (!trimmed) {
      // Empty state — surface recent searches first.
      for (const q of this.recentSearches) {
        items.push({
          group: 'recent', groupLabel: 'Recent searches', icon: 'history',
          label: q,
          activate: () => { this.query = q; this.runNlqSearch(); },
        });
      }
      items.push(...this.allActions);
      items.push(...this.allSmartFilters);
      items.push(...this.allNavLinks);
    } else {
      // Matching loads from the most recent NLQ response (if it matches the input).
      if (this.nlqLoads.length && this.nlqQuery.toLowerCase() === trimmed.toLowerCase()) {
        for (const load of this.nlqLoads.slice(0, 5)) {
          items.push({
            group: 'loads', groupLabel: this.nlqFallback ? 'Matching Loads (keyword)' : 'Matching Loads', icon: 'local_shipping',
            label: this.formatLoadLabel(load),
            hint: this.formatLoadHint(load),
            activate: () => this.navigate(['/loads', load.id]),
          });
        }
      }

      // Always offer a "Search loads for…" trigger so Enter on a fresh query runs NLQ.
      items.push({
        group: 'search', groupLabel: 'Search', icon: this.loading ? 'hourglass_empty' : 'search',
        label: this.loading ? `Searching for "${trimmed}"…` : `Search loads for "${trimmed}"`,
        hint: 'Press Enter to run a natural-language search',
        activate: () => { if (!this.loading) { this.runNlqSearch(); } },
      });

      const lower = trimmed.toLowerCase();
      const match = (item: PaletteItem) =>
        item.label.toLowerCase().includes(lower) ||
        (item.hint || '').toLowerCase().includes(lower);
      items.push(...this.allActions.filter(match));
      items.push(...this.allSmartFilters.filter(match));
      items.push(...this.allNavLinks.filter(match));
    }

    this.visibleItems = items;
    if (this.selectedIndex >= this.visibleItems.length) {
      this.selectedIndex = Math.max(0, this.visibleItems.length - 1);
    }
  }

  private runNlqSearch(): void {
    const q = this.query.trim();
    if (!q || this.loading) { return; }
    this.loading = true;
    this.rebuildVisibleItems();
    this.cdr.markForCheck();

    this.palette.pushRecentSearch(q);
    this.recentSearches = this.palette.getRecentSearches();

    const url = `${environment.apiUrl}/loads/search/nlq`;
    this.http.post<NlqResponse>(url, { query: q }).subscribe({
      next: (res) => {
        this.loading = false;
        this.nlqQuery = q;
        this.nlqLoads = Array.isArray(res?.loads) ? res!.loads! : [];
        this.nlqFallback = !!res?.fallback;
        this.selectedIndex = 0;
        this.rebuildVisibleItems();
        this.cdr.markForCheck();
      },
      error: (err: HttpErrorResponse) => {
        this.loading = false;
        this.nlqQuery = q;
        this.nlqLoads = [];
        this.nlqFallback = false;
        // Endpoint not yet available (FN-801) → silently degrade; nav/actions still work.
        if (err && err.status !== 404 && err.status !== 0) {
          console.warn('[command-palette] NLQ search failed', err.status, err.message);
        }
        this.rebuildVisibleItems();
        this.cdr.markForCheck();
      },
    });
  }

  private navigate(commands: any[], queryParams?: Record<string, string>): void {
    this.close();
    this.router.navigate(commands, queryParams ? { queryParams } : undefined);
  }

  private formatLoadLabel(load: NlqLoadResult): string {
    const number = load.load_number || load.loadNumber || load.id;
    const broker = load.broker_name || load.brokerName;
    return broker ? `Load ${number} — ${broker}` : `Load ${number}`;
  }

  private formatLoadHint(load: NlqLoadResult): string {
    const parts: string[] = [];
    const driver = load.driver_name || load.driverName;
    if (driver) { parts.push(driver); }
    const status = load.status;
    if (status) { parts.push(this.titleCase(status)); }
    const billing = load.billing_status || load.billingStatus;
    if (billing) { parts.push(`Billing: ${this.titleCase(billing)}`); }
    if (typeof load.rate === 'number') { parts.push(`$${load.rate.toLocaleString()}`); }
    return parts.join(' · ');
  }

  private titleCase(value: string): string {
    return value
      .toLowerCase()
      .split(/[\s_]+/)
      .map(w => w ? w[0].toUpperCase() + w.slice(1) : '')
      .join(' ');
  }

  private todayIso(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
