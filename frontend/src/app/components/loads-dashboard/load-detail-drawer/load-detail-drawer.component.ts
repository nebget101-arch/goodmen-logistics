import {
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
import { LoadDetail, LoadStatus, LoadStop } from '../../../models/load-dashboard.model';
import { LoadsService } from '../../../services/loads.service';
import { UserPreferencesService } from '../../../services/user-preferences.service';
import { StepBasicsData } from '../load-wizard/step-basics/step-basics.component';
import { WizardAttachment } from '../load-wizard/step-attachments/step-attachments.component';

export type DrawerTab = 'basics' | 'stops' | 'driver' | 'attachments';

export const DRAWER_MIN_WIDTH = 600;
export const DRAWER_MAX_WIDTH = 800;
export const DRAWER_DEFAULT_WIDTH = 720;

/**
 * FN-788 / FN-808 — Phase 2 Load Detail Side Drawer.
 *
 * Slide-out drawer that replaces the full-screen edit modal for viewing/editing
 * a load while the list remains visible. Tabs reuse the Load Wizard step
 * components (Basics / Stops / Driver / Attachments). Width is drag-resizable
 * between 600–800px and persisted per user.
 *
 * Ownership contract:
 *  - Parent supplies `[loadId]` and resets it to null to close.
 *  - Drawer fetches its own detail via LoadsService.
 *  - Save emits `(savedLoad)` with the updated detail; Cancel emits `(close)`
 *    after an optional unsaved-changes confirmation dialog.
 */
@Component({
  selector: 'app-load-detail-drawer',
  templateUrl: './load-detail-drawer.component.html',
  styleUrls: ['./load-detail-drawer.component.scss'],
})
export class LoadDetailDrawerComponent implements OnInit, OnChanges, OnDestroy {
  /** Load ID to fetch and edit. Setting to null closes the drawer (via parent). */
  @Input() loadId: string | null = null;

  /** Persisted width in px (parent owns persistence; drawer just clamps + emits). */
  @Input() width: number = DRAWER_DEFAULT_WIDTH;

  /** Whether prev arrow is enabled. */
  @Input() hasPrev = false;

  /** Whether next arrow is enabled. */
  @Input() hasNext = false;

  @Output() close = new EventEmitter<void>();
  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() expand = new EventEmitter<void>();
  @Output() widthChange = new EventEmitter<number>();
  /** Emitted after a successful save with the refreshed LoadDetail. */
  @Output() savedLoad = new EventEmitter<LoadDetail>();

  // ─── Internal state ───────────────────────────────────────────────────────
  loadDetail: LoadDetail | null = null;
  loading = false;
  errorMessage = '';
  saving = false;
  activeTab: DrawerTab = 'basics';

  /** Working copy of edit form data; mirrors wizard step bindings. */
  basics: StepBasicsData = this.defaultBasics();
  stops: LoadStop[] = [];
  driverId: string | null = null;
  truckId: string | null = null;
  trailerId: string | null = null;
  attachments: WizardAttachment[] = [];

  dirty = false;
  showUnsavedWarning = false;

  // Resize handle drag state
  private resizing = false;
  private resizeStartX = 0;
  private resizeStartWidth = DRAWER_DEFAULT_WIDTH;

  readonly MIN_WIDTH = DRAWER_MIN_WIDTH;
  readonly MAX_WIDTH = DRAWER_MAX_WIDTH;

  readonly tabs: { id: DrawerTab; label: string; icon: string }[] = [
    { id: 'basics',      label: 'Basics',      icon: 'assignment' },
    { id: 'stops',       label: 'Stops',       icon: 'place' },
    { id: 'driver',      label: 'Driver',      icon: 'local_shipping' },
    { id: 'attachments', label: 'Attachments', icon: 'attach_file' },
  ];

  @ViewChild('drawerPanel', { static: false }) drawerPanelRef?: ElementRef<HTMLElement>;

  constructor(
    private loadsService: LoadsService,
    private userPreferences: UserPreferencesService,
  ) {}

  ngOnInit(): void {
    if (this.loadId) { this.fetchLoad(this.loadId); }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // New load ID → re-fetch and reset dirty state. Keep the drawer open
    // (no close/reopen animation) so cross-row navigation stays smooth.
    if (changes['loadId'] && !changes['loadId'].firstChange) {
      const id = changes['loadId'].currentValue as string | null;
      this.dirty = false;
      this.showUnsavedWarning = false;
      this.activeTab = 'basics';
      if (id) { this.fetchLoad(id); } else { this.loadDetail = null; }
    }
  }

  ngOnDestroy(): void {
    this.teardownResizeListeners();
  }

  // ─── Data fetch / populate ────────────────────────────────────────────────

  private fetchLoad(id: string): void {
    this.loading = true;
    this.errorMessage = '';
    this.loadsService.getLoad(id).subscribe({
      next: (res: any) => {
        const detail = res?.data || res || null;
        this.loadDetail = detail;
        this.populateFromDetail(detail);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Failed to load detail.';
      },
    });
  }

  private populateFromDetail(d: LoadDetail | null): void {
    if (!d) {
      this.basics = this.defaultBasics();
      this.stops = [];
      this.driverId = null;
      this.truckId = null;
      this.trailerId = null;
      this.attachments = [];
      return;
    }
    this.basics = {
      loadNumber: d.load_number || '',
      status: (d.status as string) || 'DRAFT',
      billingStatus: (d.billing_status as string) || 'PENDING',
      brokerId: d.broker_id || null,
      brokerName: d.broker_name || '',
      poNumber: d.po_number || '',
      rate: d.rate != null ? Number(d.rate) : null,
      dispatcher: (d as any).dispatcher_name || '',
      notes: d.notes || '',
    };
    this.stops = (d.stops || [])
      .slice()
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    this.driverId = d.driver_id || null;
    this.truckId = d.truck_id || null;
    this.trailerId = d.trailer_id || null;
    this.attachments = [];
    this.dirty = false;
  }

  private defaultBasics(): StepBasicsData {
    return {
      loadNumber: '',
      status: 'DRAFT',
      billingStatus: 'PENDING',
      brokerId: null,
      brokerName: '',
      poNumber: '',
      rate: null,
      dispatcher: '',
      notes: '',
    };
  }

  // ─── Wizard step change handlers (pass-through) ───────────────────────────

  onBasicsChange(data: StepBasicsData): void {
    this.basics = data;
    this.dirty = true;
  }
  onStopsChange(stops: LoadStop[]): void {
    this.stops = stops;
    this.dirty = true;
  }
  onDriverChange(id: string | null): void { this.driverId = id; this.dirty = true; }
  onTruckChange(id: string | null): void { this.truckId = id; this.dirty = true; }
  onTrailerChange(id: string | null): void { this.trailerId = id; this.dirty = true; }
  onAttachmentsChange(atts: WizardAttachment[]): void {
    this.attachments = atts;
    this.dirty = true;
  }

  // ─── Tab selection ────────────────────────────────────────────────────────

  selectTab(tab: DrawerTab): void { this.activeTab = tab; }

  // ─── Prev / Next navigation ───────────────────────────────────────────────

  onPrev(): void {
    if (!this.hasPrev) { return; }
    this.confirmDiscardThen(() => this.prev.emit());
  }

  onNext(): void {
    if (!this.hasNext) { return; }
    this.confirmDiscardThen(() => this.next.emit());
  }

  // ─── Close / unsaved-changes ──────────────────────────────────────────────

  requestClose(): void {
    if (this.dirty) {
      this.showUnsavedWarning = true;
    } else {
      this.close.emit();
    }
  }

  confirmDiscard(): void {
    this.showUnsavedWarning = false;
    this.dirty = false;
    this.close.emit();
  }

  dismissUnsavedWarning(): void { this.showUnsavedWarning = false; }

  private confirmDiscardThen(action: () => void): void {
    if (!this.dirty) { action(); return; }
    // eslint-disable-next-line no-alert
    const ok = confirm('You have unsaved changes. Discard and continue?');
    if (ok) {
      this.dirty = false;
      action();
    }
  }

  // ─── Save ─────────────────────────────────────────────────────────────────

  onSaveClick(): void {
    if (!this.loadDetail || !this.loadId || this.saving) { return; }
    this.saving = true;
    this.errorMessage = '';
    const payload = this.buildUpdatePayload();
    this.loadsService.updateLoad(this.loadId, payload).subscribe({
      next: (res: any) => {
        this.saving = false;
        const refreshed: LoadDetail = res?.data || this.loadDetail!;
        this.loadDetail = refreshed;
        this.populateFromDetail(refreshed);
        this.savedLoad.emit(refreshed);
      },
      error: (err: any) => {
        this.saving = false;
        this.errorMessage = err?.error?.error || err?.error?.message || 'Save failed.';
      },
    });
  }

  private buildUpdatePayload(): Record<string, unknown> {
    const stops: LoadStop[] = (this.stops || []).map((s, i) => ({
      ...s,
      sequence: s.sequence ?? i + 1,
    }));
    return {
      status: this.basics.status,
      billingStatus: this.basics.billingStatus,
      brokerId: this.basics.brokerId || null,
      brokerName: this.basics.brokerName || null,
      poNumber: this.basics.poNumber || null,
      rate: this.basics.rate != null ? Number(this.basics.rate) : 0,
      notes: this.basics.notes || null,
      driverId: this.driverId || null,
      truckId: this.truckId || null,
      trailerId: this.trailerId || null,
      stops,
    };
  }

  // ─── Resize drag handle ───────────────────────────────────────────────────

  onResizeHandleMouseDown(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.width || DRAWER_DEFAULT_WIDTH;
    document.addEventListener('mousemove', this.onResizeMove, true);
    document.addEventListener('mouseup', this.onResizeUp, true);
    document.body.classList.add('drawer-resizing');
  }

  private onResizeMove = (ev: MouseEvent): void => {
    if (!this.resizing) { return; }
    // Drawer is anchored right, so dragging left (delta < 0) grows the drawer.
    const delta = ev.clientX - this.resizeStartX;
    const next = this.clampWidth(this.resizeStartWidth - delta);
    if (next !== this.width) {
      this.width = next;
    }
  };

  private onResizeUp = (): void => {
    if (!this.resizing) { return; }
    this.resizing = false;
    this.teardownResizeListeners();
    const clamped = this.clampWidth(this.width);
    this.width = clamped;
    // Notify parent so it can persist the new width.
    this.widthChange.emit(clamped);
  };

  private teardownResizeListeners(): void {
    document.removeEventListener('mousemove', this.onResizeMove, true);
    document.removeEventListener('mouseup', this.onResizeUp, true);
    document.body.classList.remove('drawer-resizing');
  }

  private clampWidth(px: number): number {
    if (!isFinite(px)) { return DRAWER_DEFAULT_WIDTH; }
    return Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, Math.round(px)));
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.showUnsavedWarning) {
      this.dismissUnsavedWarning();
      event.preventDefault();
      return;
    }
    this.requestClose();
    event.preventDefault();
  }

  // ─── Helpers for template ─────────────────────────────────────────────────

  get loadStatusForPill(): LoadStatus | null {
    return (this.loadDetail?.status as LoadStatus) ?? null;
  }
}
