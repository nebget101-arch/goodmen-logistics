import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
  ViewChildren
} from '@angular/core';

export interface CompanySwitcherEntity {
  id: string;
  name: string;
  mcNumber?: string | null;
  dotNumber?: string | null;
  isDefault?: boolean;
}

const ALL_ENTITIES_ID = 'all';
const ALL_ENTITIES_LABEL = 'All Entities';

const INITIALS_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#1e3a8a', fg: '#bfdbfe' },
  { bg: '#7c2d12', fg: '#fed7aa' },
  { bg: '#14532d', fg: '#bbf7d0' },
  { bg: '#581c87', fg: '#e9d5ff' },
  { bg: '#155e75', fg: '#a5f3fc' },
  { bg: '#9f1239', fg: '#fecdd3' }
];

interface InitialsAvatar {
  initials: string;
  bg: string;
  fg: string;
}

interface SwitcherRow {
  id: string;
  name: string;
  mcNumber: string | null;
  avatar: InitialsAvatar;
  isAllEntities: boolean;
}

@Component({
  selector: 'app-company-switcher',
  templateUrl: './company-switcher.component.html',
  styleUrls: ['./company-switcher.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CompanySwitcherComponent implements OnChanges, AfterViewInit {
  @Input() entities: CompanySwitcherEntity[] = [];
  @Input() selectedEntityId: string | null = null;
  @Input() showAllEntities = false;
  @Input() loading = false;
  @Input() compact = false;

  @Output() entitySelected = new EventEmitter<string>();

  @ViewChild('triggerBtn') triggerBtnRef?: ElementRef<HTMLButtonElement>;
  @ViewChild('popover') popoverRef?: ElementRef<HTMLDivElement>;
  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChildren('rowEl') rowElements?: QueryList<ElementRef<HTMLLIElement>>;

  open = false;
  search = '';
  activeIndex = 0;
  isMobileViewport = false;

  rows: SwitcherRow[] = [];
  filteredRows: SwitcherRow[] = [];
  selectedRow: SwitcherRow | null = null;

  constructor(private cdr: ChangeDetectorRef) {
    this.updateMobileViewport();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['entities'] || changes['showAllEntities']) {
      this.rebuildRows();
    }
    if (changes['selectedEntityId'] || changes['entities']) {
      this.recomputeSelected();
    }
    if (changes['loading'] && this.loading) {
      this.open = false;
    }
    this.applyFilter();
  }

  ngAfterViewInit(): void {
    this.updateMobileViewport();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateMobileViewport();
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    const target = event.target as Node | null;
    if (!target) return;
    const triggerEl = this.triggerBtnRef?.nativeElement;
    const popoverEl = this.popoverRef?.nativeElement;
    if (triggerEl?.contains(target) || popoverEl?.contains(target)) return;
    this.closePopover();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.closePopover(true);
  }

  get isReadOnly(): boolean {
    if (this.loading) return true;
    const totalRows = this.entities.length + (this.showAllEntities ? 1 : 0);
    return totalRows <= 1;
  }

  get triggerAriaExpanded(): string {
    return this.open ? 'true' : 'false';
  }

  toggleOpen(): void {
    if (this.isReadOnly || this.loading) return;
    if (this.open) this.closePopover();
    else this.openPopover();
  }

  openPopover(): void {
    if (this.isReadOnly || this.loading) return;
    this.open = true;
    this.search = '';
    this.applyFilter();
    this.activeIndex = Math.max(
      0,
      this.filteredRows.findIndex((r) => r.id === this.selectedRow?.id)
    );
    this.cdr.markForCheck();
    setTimeout(() => {
      const isMobileSheet = this.compact && this.isMobileViewport;
      if (!isMobileSheet) {
        this.searchInputRef?.nativeElement?.focus();
      }
      this.scrollActiveIntoView();
    }, 0);
  }

  closePopover(returnFocusToTrigger = false): void {
    if (!this.open) return;
    this.open = false;
    this.search = '';
    this.applyFilter();
    this.cdr.markForCheck();
    if (returnFocusToTrigger) {
      setTimeout(() => this.triggerBtnRef?.nativeElement?.focus(), 0);
    }
  }

  onSearchChange(value: string): void {
    this.search = value;
    this.applyFilter();
    this.activeIndex = 0;
    this.cdr.markForCheck();
  }

  onSelectRow(row: SwitcherRow): void {
    this.entitySelected.emit(row.id);
    this.closePopover(true);
  }

  onListKeydown(event: KeyboardEvent): void {
    if (!this.open) return;
    const max = this.filteredRows.length - 1;
    if (max < 0) {
      if (event.key === 'Escape') this.closePopover(true);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex = Math.min(max, this.activeIndex + 1);
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex = Math.max(0, this.activeIndex - 1);
        this.scrollActiveIntoView();
        break;
      case 'Home':
        event.preventDefault();
        this.activeIndex = 0;
        this.scrollActiveIntoView();
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex = max;
        this.scrollActiveIntoView();
        break;
      case 'Enter':
        event.preventDefault();
        const row = this.filteredRows[this.activeIndex];
        if (row) this.onSelectRow(row);
        break;
      case 'Escape':
        event.preventDefault();
        this.closePopover(true);
        break;
    }
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (this.isReadOnly) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openPopover();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openPopover();
    }
  }

  trackById(_index: number, row: SwitcherRow): string {
    return row.id;
  }

  private updateMobileViewport(): void {
    if (typeof window === 'undefined') {
      this.isMobileViewport = false;
      return;
    }
    this.isMobileViewport = window.innerWidth <= 768;
  }

  private rebuildRows(): void {
    const list: SwitcherRow[] = [];
    if (this.showAllEntities) {
      list.push({
        id: ALL_ENTITIES_ID,
        name: ALL_ENTITIES_LABEL,
        mcNumber: null,
        avatar: { initials: '★', bg: '#0f172a', fg: '#fbbf24' },
        isAllEntities: true
      });
    }
    for (const e of this.entities || []) {
      list.push({
        id: e.id,
        name: e.name || '',
        mcNumber: e.mcNumber ? String(e.mcNumber) : null,
        avatar: this.makeAvatar(e.id, e.name || ''),
        isAllEntities: false
      });
    }
    this.rows = list;
  }

  private recomputeSelected(): void {
    const id = this.selectedEntityId;
    if (!id) {
      this.selectedRow = null;
      return;
    }
    this.selectedRow = this.rows.find((r) => r.id === id) || null;
  }

  private applyFilter(): void {
    const q = (this.search || '').trim().toLowerCase();
    if (!q) {
      this.filteredRows = this.rows.slice();
      return;
    }
    this.filteredRows = this.rows.filter((r) => {
      if (r.isAllEntities) return ALL_ENTITIES_LABEL.toLowerCase().includes(q);
      if (r.name.toLowerCase().includes(q)) return true;
      if (r.mcNumber && r.mcNumber.toLowerCase().includes(q)) return true;
      return false;
    });
    if (this.activeIndex >= this.filteredRows.length) {
      this.activeIndex = Math.max(0, this.filteredRows.length - 1);
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      const el = this.rowElements?.toArray()[this.activeIndex]?.nativeElement;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }, 0);
  }

  private makeAvatar(id: string, name: string): InitialsAvatar {
    const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
    const a = tokens[0]?.charAt(0) || '';
    const b = tokens[1]?.charAt(0) || '';
    const initials = (a + b || a || '?').toUpperCase();
    const idx = this.hashToIndex(id || name, INITIALS_PALETTE.length);
    const palette = INITIALS_PALETTE[idx];
    return { initials, bg: palette.bg, fg: palette.fg };
  }

  private hashToIndex(value: string, modulo: number): number {
    if (modulo <= 0) return 0;
    let h = 0;
    const s = value || '';
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h) % modulo;
  }
}
