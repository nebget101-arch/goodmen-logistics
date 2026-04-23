import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ConnectedPosition, ScrollStrategy, ScrollStrategyOptions } from '@angular/cdk/overlay';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, forkJoin, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import * as L from 'leaflet';
import {
  LoadAttachment,
  LoadAttachmentType,
  LoadDetail,
  LoadListItem,
  LoadStatus,
  BillingStatus,
  LoadStop,
  LoadAiEndpointExtraction
} from '../../models/load-dashboard.model';
import {
  LoadsService,
  BrokerOption,
  SmartFilterCounts,
  SmartFilterKey,
  SMART_FILTER_KEYS
} from '../../services/loads.service';
import { LoadTemplatesService } from '../../services/load-templates.service';
import { KeyboardShortcutsService } from '../../shared/services/keyboard-shortcuts.service';
import { UserPreferencesService, LoadsSavedView } from '../../services/user-preferences.service';
import { environment } from '../../../environments/environment';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';
import { StepBasicsData } from './load-wizard/step-basics/step-basics.component';
import { WizardAttachment } from './load-wizard/step-attachments/step-attachments.component';
import {
  IntelligenceMetrics,
  IntelligencePeriod,
} from './intelligence-panel/intelligence-panel.component';
import {
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
} from './load-detail-drawer/load-detail-drawer.component';
import { EmptyStateMode } from './empty-state/empty-state.component';
import { SkeletonColumn } from './loading-skeleton/loading-skeleton.component';

type DensityMode = 'compact' | 'comfortable' | 'spacious';

type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-loads-dashboard',
  templateUrl: './loads-dashboard.component.html',
  styleUrls: ['./loads-dashboard.component.scss']
})
export class LoadsDashboardComponent implements OnInit, OnDestroy {
  loads: LoadListItem[] = [];
  loading = true;
  errorMessage = '';
  successMessage = '';

  // ─── FN-821: list-level error + empty state flags ───────────────────────────
  /** True when the last list fetch failed. Drives the empty-state error card. */
  loadError = false;
  /** 403 variant of loadError — shows the permission-denied empty-state instead. */
  permissionDenied = false;
  /** Detail string surfaced on the error card (under the headline). */
  loadErrorDetail = '';
  /** FN-821: WebSocket banner — wired by FN-790 when WS client service lands on dev. */
  wsDisconnected = false;
  /** FN-821: brief fade-in pulse on `.loads-viewport` whenever filters/sort change. */
  filterPulseActive = false;
  private filterPulseTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── FN-821: density mode ──────────────────────────────────────────────────
  densityMode: DensityMode = 'comfortable';
  densityMenuOpen = false;
  readonly densityOptions: { value: DensityMode; label: string; icon: string; heightPx: number }[] = [
    { value: 'compact', label: 'Compact', icon: 'density_small', heightPx: 36 },
    { value: 'comfortable', label: 'Comfortable', icon: 'density_medium', heightPx: 52 },
    { value: 'spacious', label: 'Spacious', icon: 'density_large', heightPx: 72 },
  ];

  // ─── FN-821: scroll-to-top button ──────────────────────────────────────────
  showScrollTop = false;

  /** Column width map mirroring the <col> widths in the template. */
  private readonly columnWidthMap: Record<string, string> = {
    load_number: '6%',
    pickup_date: '7%',
    driver: '8%',
    broker: '12%',
    po_number: '7%',
    pickup: '11%',
    delivery: '11%',
    rate: '5%',
    completed_date: '8%',
    status: '6%',
    billing: '6%',
    notes: '10%',
    attachments: '8%',
    actions: '5%',
  };
  activeOperatingEntityName = '';

  showNewLoadMenu = false;
  showManualModal = false;
  showAutoModal = false;

  // ─── Load Wizard (FN-732) ───────────────────────────────────────────────
  /** Whether the 4-step load creation wizard is open. */
  showLoadWizard = false;
  /** Index of the currently active wizard step (0-based, 0–3). */
  wizardActiveStep = 0;
  /** Validity state of each wizard step — used by the progress bar jump guard. */
  wizardStepValid: boolean[] = [false, false, false, false];
  /** True when the user has made unsaved edits inside the wizard. */
  wizardDirty = false;
  /** FN-749: True when the wizard is editing an existing load. */
  wizardEditMode = false;
  /** FN-749: The load ID being edited in the wizard (null for new loads). */
  wizardEditLoadId: string | null = null;
  /** FN-749: Pre-filled wizard data from loaded existing load. */
  wizardPrefilledData: any = null;

  // FN-778: Per-step form state projected into the wizard children.
  wizardBasics: StepBasicsData = this.defaultBasics();
  wizardStops: LoadStop[] = [];
  wizardDriverId: string | null = null;
  wizardTruckId: string | null = null;
  wizardTrailerId: string | null = null;
  wizardAttachments: WizardAttachment[] = [];
  wizardAiExtractedPdf: File | null = null;
  wizardAiPrefilledFields: Set<string> = new Set();
  showBulkUploadModal = false;
  showDetailsModal = false;
  showInlineNewLoad = false;

  // ─── Load Templates (FN-755) ────────────────────────────────────────────
  /** Save-As-Template dialog state. */
  showSaveAsTemplateModal = false;
  saveAsTemplateName = '';
  saveAsTemplateDescription = '';
  saveAsTemplateSubmitting = false;
  saveAsTemplateError = '';
  /** Load ID the save-as-template dialog is tied to. */
  private saveAsTemplateLoadId: string | null = null;
  showRouteModal = false;
  showNewStopModal = false;
  selectedLoad: LoadDetail | null = null;
  /** ID of load whose row actions menu is open (for click-outside close). */
  actionsOpenLoadId: string | null = null;
  /** True while POST /loads and uploads are in progress (modal submit). */
  creatingLoad = false;
  /** When set, manual modal is in edit mode for this load ID. */
  editingLoadId: string | null = null;
  /** Full detail for the load being edited (for attachments tabs). */
  editingLoadDetail: LoadDetail | null = null;

  /** Active tab in the attachments/extra section of the edit modal. */
  attachmentTab: 'services' | 'documents' | 'billing' | 'history' = 'documents';
  /** Upload attachment modal state. */
  showUploadModal = false;
  uploadAttachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  uploadAttachmentNotes = '';
  uploadSelectedFiles: FileList | null = null;

  /** Replace (edit) attachment modal state. */
  showReplaceModal = false;
  editingAttachment: LoadAttachment | null = null;
  replaceAttachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  replaceAttachmentNotes = '';
  replaceAttachmentFile: File | null = null;
  replacingAttachment = false;

  readonly attachmentTypeOptions: LoadAttachmentType[] = [
    'RATE_CONFIRMATION',
    'BOL',
    'LUMPER',
    'PROOF_OF_DELIVERY',
    'ROADSIDE_MAINTENANCE_RECEIPT',
    'OTHER',
    'CONFIRMATION'
  ];

  // Auto-create from PDF state
  autoPdfFile: File | null = null;
  autoExtracting = false;
  autoError = '';
  autoExtraction: LoadAiEndpointExtraction | null = null;

  // Bulk upload rate confirmations
  bulkPdfFiles: File[] = [];
  bulkUploading = false;
  bulkError = '';
  bulkResults: Array<{ success: boolean; data?: LoadDetail; error?: string; filename: string }> = [];

  // FN-745: Bulk extraction grid
  showBulkExtractionGrid = false;
  bulkExtractionFiles: File[] = [];

  deletingDraft = false;

  drivers: { id: string; name: string; truckId?: string | null; trailerId?: string | null }[] = [];
  trucks: { id: string; label: string }[] = [];
  trailers: { id: string; label: string }[] = [];
  brokers: { id: string; name: string }[] = [];
  brokerDropdownOpen = false;
  /** Broker search results from API (search-by-query). */
  brokerSearchResults: BrokerOption[] = [];
  brokerSearchLoading = false;
  /** Add new broker modal and form. */
  showBrokerCreateModal = false;
  brokerCreateForm: FormGroup;
  brokerCreateSaving = false;
  brokerCreateError = '';

  dispatcherName = '';
  dispatcherUserId: string | null = null;

  manualLoadForm: FormGroup;
  pendingAttachments: Array<{ file: File; type: LoadAttachmentType; notes?: string }> = [];
  attachmentType: LoadAttachmentType = 'RATE_CONFIRMATION';
  attachmentNotes = '';
  attachmentError = '';
  selectedAttachmentFiles: FileList | null = null;

  search$ = new Subject<string>();

  /** FN-765: reference to the header search input for `/` and Cmd/Ctrl+K shortcuts. */
  @ViewChild('searchInput', { static: false }) searchInputRef?: ElementRef<HTMLInputElement>;

  /** FN-821: hidden file input used by the "Import from PDF" empty-state action. */
  @ViewChild('emptyStateBulkInput', { static: false }) emptyStateBulkInput?: ElementRef<HTMLInputElement>;

  /** FN-765: unregister callback returned by KeyboardShortcutsService.registerAll. */
  private _unregisterShortcuts: (() => void) | null = null;
  /** Broker search query – debounced and switchMap cancels in-flight requests. */
  private brokerSearch$ = new Subject<string>();
  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  // Inline searchable combos for driver / truck / trailer
  driverSearch = '';
  truckSearch = '';
  trailerSearch = '';
  driverDropdownOpen = false;
  truckDropdownOpen = false;
  trailerDropdownOpen = false;
  sortedStops: LoadStop[] = [];
  newStopForm: FormGroup;
  newStopError = '';
  savingNewStop = false;
  showEditStopModal = false;
  editingStopIndex: number | null = null;
  editStopForm: FormGroup;
  editStopError = '';
  savingEditStop = false;

  routeMap: L.Map | null = null;
  routeMapLayer: 'map' | 'satellite' = 'map';
  routeMapLoading = false;
  routeMapError = '';
  private routeWaypoints: { lat: number; lon: number }[] = [];
  private routeGeometry: { coordinates: [number, number][] } | null = null;
  private routeTileLayers: { map: L.TileLayer; satellite: L.TileLayer } | null = null;

  page = 1;
  pageSize = 25;
  total = 0;

  // ─── FN-808: Load Detail Side Drawer ────────────────────────────────────
  /** When non-null, the drawer is open and shows the detail for this load. */
  drawerLoadId: string | null = null;
  /** Drawer width in px (persisted via UserPreferences). */
  drawerWidth: number = DRAWER_DEFAULT_WIDTH;
  /** FN-818: when the drawer was opened via the confidence badge, highlight low-conf fields. */
  drawerFocusLowConfidence = false;

  // ─── FN-818: AI extraction visual markers ───────────────────────────────
  /** Loads whose IDs are brand-new AI-sourced rows — receive a one-off glow on first render. */
  newAiLoadIds = new Set<string>();
  /** Tracks which load IDs were already present in the list so we can diff on refresh. */
  private previousLoadIds = new Set<string>();
  /** First list load: suppress glow so the initial render isn't a spotlight of everything. */
  private seenFirstLoadsResponse = false;
  /** Handle for the timer that clears the glow after the animation completes. */
  private newAiGlowTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── FN-768: Bulk selection + actions ─────────────────────────────────────
  /** Set of load ids the user has checked for bulk operations. */
  selectedIds = new Set<string>();
  /** Value chosen in the bulk-status dropdown. Empty string = no action pending. */
  bulkStatusToApply = '';
  /** Value chosen in the bulk-driver dropdown. */
  bulkDriverToApply = '';
  /** Value chosen in the bulk-truck dropdown. */
  bulkTruckToApply = '';
  /** Whether a bulk operation network call is currently in flight. */
  bulkActionInFlight = false;

  /** FN-795: collapsible status/billing chip rows — collapsed by default. */
  chipRowsOpen = false;

  /** True when current user has role driver (sees only their loads, can upload docs). */
  isDriverRole = false;

  filters: {
    status: string;
    billingStatus: string;
    driverId: string;
    q: string;
    /** FN-746: shows only loads flagged for dispatcher review. */
    needsReview: boolean;
    /** FN-762: restricts to loads created from a given source (e.g. 'email'). */
    source: string;
  } = {
    status: '',
    billingStatus: '',
    driverId: '',
    q: '',
    needsReview: false,
    source: ''
  };

  // FN-798: Smart filter chips (AND'd server-side). Each entry is a chip key
  // from SMART_FILTER_KEYS. `smartFilterCounts` backs the badge numbers.
  smartFilterKeys: SmartFilterKey[] = [];
  smartFilterCounts: SmartFilterCounts | null = null;
  smartFilterCountsLoading = false;

  sortBy: 'load_number' | 'pickup_date' | 'rate' | 'completed_date' = 'pickup_date';
  /** Default: newest pickups first on initial page load / refresh. */
  sortDir: SortDir = 'desc';

  // Summary totals for quick gross amount reporting on current page
  summaryTotals: {
    totalGross: number;
    byStatus: { [key: string]: number };
    byBilling: { [key: string]: number };
  } = {
    totalGross: 0,
    byStatus: {},
    byBilling: {}
  };

  // Header row filters (per-column filters under table headers)
  headerFilters: {
    date: string;
    driver: string;
    broker: string;
    po: string;
    pickup: string;
    delivery: string;
    rate: string;
    completed: string;
    status: string;
    billingStatus: string;
    attachmentType: string;
  } = {
    date: '',
    driver: '',
    broker: '',
    po: '',
    pickup: '',
    delivery: '',
    rate: '',
    completed: '',
    status: '',
    billingStatus: '',
    attachmentType: ''
  };

  get maxPage(): number {
    return Math.max(Math.ceil(this.total / this.pageSize), 1);
  }

  pickupCityEdited = false;
  pickupStateEdited = false;
  deliveryCityEdited = false;
  deliveryStateEdited = false;

  statusOptions: LoadStatus[] = ['NEW', 'DRAFT', 'DISPATCHED', 'CANCELLED', 'TONU', 'EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
  billingOptions: BillingStatus[] = ['PENDING', 'CANCELLED', 'BOL_RECEIVED', 'INVOICED', 'SENT_TO_FACTORING', 'FUNDED', 'PAID'];

  // ─── FN-767: Column visibility + saved views + inline status ───────────────
  /** Ordered column metadata matching the loads table. `alwaysVisible` columns
   *  cannot be hidden by the user (e.g. load number, actions). */
  readonly columnDefs: { key: string; label: string; alwaysVisible?: boolean }[] = [
    { key: 'load_number', label: 'Load #', alwaysVisible: true },
    { key: 'pickup_date', label: 'Pickup Date' },
    { key: 'driver', label: 'Driver' },
    { key: 'broker', label: 'Broker' },
    { key: 'po_number', label: 'PO #' },
    { key: 'pickup', label: 'Pickup' },
    { key: 'delivery', label: 'Delivery' },
    { key: 'rate', label: 'Rate' },
    { key: 'completed_date', label: 'Completed' },
    { key: 'status', label: 'Status' },
    { key: 'billing', label: 'Billing' },
    { key: 'notes', label: 'Notes' },
    { key: 'attachments', label: 'Attachments' },
    { key: 'actions', label: 'Actions', alwaysVisible: true }
  ];
  /** Map of column key → visible. Defaults to all visible; overridden by loaded preferences. */
  visibleColumns: Record<string, boolean> = {};
  savedViews: LoadsSavedView[] = [];
  showColumnPicker = false;
  showSavedViewsMenu = false;
  /** Name input buffer for "Save current view as…". */
  newViewName = '';
  /** ID of the load whose inline status dropdown is open. */
  statusMenuLoadId: string | null = null;

  // FN-854: Inline Status/Billing dropdowns render through a CDK Overlay
  // portal. Rendering inline inside the <td> gets clipped by the parent
  // cdk-virtual-scroll-viewport's overflow:auto, so the menu was never
  // visible to the user.
  readonly inlineMenuPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  inlineMenuScrollStrategy!: ScrollStrategy;

  // ─── FN-805: Hover toolbar + inline billing/notes editing ───────────────
  /** ID of the load whose inline billing dropdown is open. */
  billingMenuLoadId: string | null = null;
  /** ID of the load whose notes cell is in inline-edit mode. */
  editingNotesLoadId: string | null = null;
  /** Buffer for the in-flight notes edit (committed to the row on save). */
  editingNotesDraft = '';
  /** Latched on blur so a subsequent (keydown.enter) doesn't double-save. */
  private notesSaveInFlight = false;

  /**
   * Valid NEXT status transitions per current status. Cancel/TONU are
   * terminal-escape branches available from any live state.
   * Happy path: DRAFT → NEW → DISPATCHED → IN_TRANSIT → DELIVERED.
   */
  private readonly statusTransitions: Record<string, LoadStatus[]> = {
    DRAFT: ['NEW', 'CANCELLED'],
    NEW: ['DISPATCHED', 'CANCELLED'],
    DISPATCHED: ['EN_ROUTE', 'PICKED_UP', 'IN_TRANSIT', 'CANCELLED', 'TONU'],
    EN_ROUTE: ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
    PICKED_UP: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
    IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
    CANCELED: [],
    TONU: []
  };

  /** Valid NEXT billing transitions per current billing_status. */
  private readonly billingTransitions: Record<string, BillingStatus[]> = {
    PENDING: ['BOL_RECEIVED', 'CANCELLED'],
    BOL_RECEIVED: ['INVOICED', 'CANCELLED'],
    INVOICED: ['SENT_TO_FACTORING', 'PAID', 'CANCELLED'],
    SENT_TO_FACTORING: ['FUNDED', 'PAID', 'CANCELLED'],
    FUNDED: ['PAID'],
    PAID: [],
    CANCELLED: [],
    CANCELED: []
  };

  /** Valid next statuses for a given load; hides options that would be no-ops. */
  getValidStatusTransitions(load: LoadListItem): LoadStatus[] {
    const current = (load.status || '').toString().toUpperCase();
    return this.statusTransitions[current] ?? [];
  }

  /** Valid next billing statuses for a given load. */
  getValidBillingTransitions(load: LoadListItem): BillingStatus[] {
    const current = (load.billing_status || '').toString().toUpperCase();
    return this.billingTransitions[current] ?? [];
  }

  // ─── FN-806: Hover-preview state (driver / broker / attachments / notes) ─
  /**
   * Cache of per-load LoadDetail fetched on hover. `null` means fetch is
   * in-flight or failed; a concrete value means we have data to display.
   */
  private loadPreviewCache = new Map<string, LoadDetail | null>();
  /** Cache of broker details keyed by broker_id. */
  private brokerPreviewCache = new Map<string, BrokerOption | null>();
  /** The load whose hover preview is currently the focus. */
  previewLoadId: string | null = null;

  /**
   * Kicks off a lazy fetch for driver/broker/attachment preview data when
   * the user hovers a driver/broker/attachments cell. Safe to call on every
   * mouseenter — the cache guards against duplicate requests.
   */
  prefetchLoadPreview(load: LoadListItem): void {
    if (!load || !load.id) return;
    this.previewLoadId = load.id;
    if (this.loadPreviewCache.has(load.id)) {
      const cached = this.loadPreviewCache.get(load.id);
      if (cached) this.prefetchBroker(cached);
      return;
    }
    this.loadPreviewCache.set(load.id, null);
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data ?? null;
        this.loadPreviewCache.set(load.id, detail);
        if (detail) this.prefetchBroker(detail);
      },
      error: () => {
        this.loadPreviewCache.delete(load.id);
      }
    });
  }

  /** Secondary fetch: look up full broker details for credit/terms line. */
  private prefetchBroker(detail: LoadDetail): void {
    const id = detail.broker_id;
    if (!id || this.brokerPreviewCache.has(id)) return;
    this.brokerPreviewCache.set(id, null);
    const searchHint = detail.broker_display_name || detail.broker_name || '';
    this.loadsService.getBrokers(searchHint, 1, 50).subscribe({
      next: (res) => {
        const found = (res?.data || []).find((b) => b.id === id) ?? null;
        this.brokerPreviewCache.set(id, found);
      },
      error: () => {
        this.brokerPreviewCache.delete(id);
      }
    });
  }

  /** The currently-hovered load's details (or null while loading / on error). */
  get previewLoad(): LoadDetail | null {
    if (!this.previewLoadId) return null;
    return this.loadPreviewCache.get(this.previewLoadId) ?? null;
  }

  /** The broker record for the currently-hovered load (null until loaded). */
  get previewBroker(): BrokerOption | null {
    const detail = this.previewLoad;
    if (!detail?.broker_id) return null;
    return this.brokerPreviewCache.get(detail.broker_id) ?? null;
  }

  /** Display string for "City, ST" position lines, or empty when unavailable. */
  getPreviewDriverPosition(): string {
    const detail = this.previewLoad;
    if (!detail) return '';
    const city = detail.driver_position_city || '';
    const state = detail.driver_position_state || '';
    if (city && state) return `${city}, ${state}`;
    return city || state || '';
  }

  /** Combine payment rating + credit score into one short line. */
  getBrokerCreditLabel(broker: BrokerOption | null): string {
    if (!broker) return '';
    const rating = (broker.payment_rating || '').toString().trim();
    const score = broker.credit_score != null ? String(broker.credit_score).trim() : '';
    if (rating && score) return `${rating} · ${score}`;
    return rating || score || '';
  }

  /** First N attachments from LoadDetail for the hover list. */
  getPreviewAttachments(max = 4): LoadAttachment[] {
    const atts = this.previewLoad?.attachments || [];
    return atts.slice(0, max);
  }

  /** Overflow count for the "+N more" line on the attachments popover. */
  getPreviewAttachmentOverflow(max = 4): number {
    const total = this.previewLoad?.attachments?.length ?? 0;
    return Math.max(0, total - max);
  }

  driverFilterOptions: AiSelectOption[] = [];
  statusFilterOptions: AiSelectOption[] = [];
  billingFilterOptions: AiSelectOption[] = [];

  attachmentTypeFilterOptions: AiSelectOption[] = [
    { value: 'RATE_CONFIRMATION', label: 'Rate Conf' },
    { value: 'BOL', label: 'BOL' },
    { value: 'LUMPER', label: 'Lumper' },
    { value: 'PROOF_OF_DELIVERY', label: 'POD' },
    { value: 'ROADSIDE_MAINTENANCE_RECEIPT', label: 'Roadside Receipt' },
    { value: 'OTHER', label: 'Other' },
    { value: 'CONFIRMATION', label: 'Confirmation' }
  ];

  // ─── FN-794: Intelligence panel state ────────────────────────────────────
  /** Current period pill (Today / Week / Month / All). Drives list + cards. */
  intelligencePeriod: IntelligencePeriod = 'all';
  /** Metric payload passed to <app-intelligence-panel>. Re-built on each load. */
  intelligenceMetrics: IntelligenceMetrics | null = null;
  /** Raw aggregate for the previous period (used to compute trend). */
  private prevIntelligenceAggregate: {
    gross: number; delivered: number; inTransit: number; needsAttention: number;
  } | null = null;
  /** True when the Needs Attention card is active (client-side filter). */
  needsAttentionActive = false;

  grossPeriod = 'all';
  grossPeriodOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'this_year', label: 'This year' },
    { value: 'last_year', label: 'Last year' },
    { value: 'last_6_months', label: 'Last 6 months' },
    { value: 'last_3_months', label: 'Last 3 months' },
    { value: 'this_month', label: 'This month' },
    { value: 'last_month', label: 'Last month' },
    { value: 'last_30_days', label: 'Last 30 days' },
    { value: 'last_7_days', label: 'Last 7 days' },
    { value: 'last_week', label: 'Last week' },
    { value: 'this_week', label: 'This week' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'today', label: 'Today' }
  ];

  /** Display labels for status dropdowns (match screenshot) */
  getStatusLabel(s: string): string {
    const map: Record<string, string> = {
      NEW: 'New', DRAFT: 'Draft', CANCELLED: 'Canceled', CANCELED: 'Canceled', TONU: 'TONU',
      DISPATCHED: 'Dispatched', EN_ROUTE: 'En Route', PICKED_UP: 'Picked-up',
      IN_TRANSIT: 'In Transit', DELIVERED: 'Delivered'
    };
    return map[s] ?? s.replace(/_/g, ' ');
  }
  getBillingLabel(s: string): string {
    const map: Record<string, string> = {
      PENDING: 'Pending', CANCELLED: 'Canceled', CANCELED: 'Canceled',
      BOL_RECEIVED: 'BOL received', INVOICED: 'Invoiced',
      SENT_TO_FACTORING: 'Sent to factoring', FUNDED: 'Funded', PAID: 'Paid'
    };
    return map[s] ?? s.replace(/_/g, ' ');
  }

  private statusColorMap: Record<string, string> = {
    NEW: '#3b82f6',
    DRAFT: '#6366f1',
    DISPATCHED: '#f97316',
    EN_ROUTE: '#eab308',
    PICKED_UP: '#eab308',
    IN_TRANSIT: '#eab308',
    DELIVERED: '#22c55e',
    CANCELLED: '#ef4444',
    CANCELED: '#ef4444',
    TONU: '#ef4444'
  };

  get statusBarSegments(): { status: string; label: string; amount: number; pct: number; color: string }[] {
    const total = this.summaryTotals.totalGross || 0;
    if (total <= 0) return [];
    return this.statusOptions
      .filter(s => (this.summaryTotals.byStatus[s] || 0) > 0)
      .map(s => ({
        status: s,
        label: this.getStatusLabel(s),
        amount: this.summaryTotals.byStatus[s] || 0,
        pct: ((this.summaryTotals.byStatus[s] || 0) / total) * 100,
        color: this.statusColorMap[s] || '#64748b'
      }));
  }

  // FN-795: color palette for billing breakdown chips.
  private billingColorMap: Record<string, string> = {
    PENDING: '#6366f1',
    BOL_RECEIVED: '#38bdf8',
    INVOICED: '#22c55e',
    SENT_TO_FACTORING: '#a78bfa',
    FUNDED: '#10b981',
    PAID: '#059669',
    CANCELLED: '#ef4444',
    CANCELED: '#ef4444',
  };

  /** FN-795: billing-status segments for the collapsible breakdown section. */
  get billingBarSegments(): { status: string; label: string; amount: number; pct: number; color: string }[] {
    const total = this.summaryTotals.totalGross || 0;
    if (total <= 0) return [];
    return this.billingOptions
      .filter(s => (this.summaryTotals.byBilling[s] || 0) > 0)
      .map(s => ({
        status: s,
        label: this.getBillingLabel(s),
        amount: this.summaryTotals.byBilling[s] || 0,
        pct: ((this.summaryTotals.byBilling[s] || 0) / total) * 100,
        color: this.billingColorMap[s] || '#64748b'
      }));
  }

  /** FN-795: toggle the collapsible Status/Billing breakdown panel. */
  toggleChipRows(): void {
    this.chipRowsOpen = !this.chipRowsOpen;
  }

  private headerFilterLabels: { [K in keyof typeof this.headerFilters]: string } = {
    date: 'Date',
    driver: 'Driver',
    broker: 'Broker',
    po: 'PO #',
    pickup: 'Pickup',
    delivery: 'Delivery',
    rate: 'Rate',
    completed: 'Completed',
    status: 'Status',
    billingStatus: 'Billing',
    attachmentType: 'Attachment'
  };

  // Convenience getters/setters for binding custom date picker to reactive form
  get pickupDateValue(): string {
    return (this.manualLoadForm.get('pickupDate')?.value as string) || '';
  }

  set pickupDateValue(value: string) {
    this.manualLoadForm.get('pickupDate')?.setValue(value);
  }

  get deliveryDateValue(): string {
    return (this.manualLoadForm.get('deliveryDate')?.value as string) || '';
  }

  set deliveryDateValue(value: string) {
    this.manualLoadForm.get('deliveryDate')?.setValue(value);
  }

  // Human-readable rate per mile for edit header
  get ratePerMileDisplay(): string {
    const d = this.editingLoadDetail;
    if (!d) return '--';

    let value: number | null = null;
    if (d.rate_per_mile != null) {
      value = d.rate_per_mile;
    } else if (d.rate != null && d.total_miles) {
      value = d.total_miles > 0 ? d.rate / d.total_miles : null;
    }

    if (value == null || !isFinite(value)) return '--';
    return value.toFixed(2);
  }

  /** Google Maps directions URL from first to last stop (when viewing route). */
  get routeMapUrl(): string {
    const stops = this.sortedStops;
    if (!stops || stops.length < 2) return '';
    const origin = stops[0];
    const dest = stops[stops.length - 1];
    const o = [origin.city, origin.state, origin.zip].filter(Boolean).join(', ');
    const d = [dest.city, dest.state, dest.zip].filter(Boolean).join(', ');
    if (!o || !d) return '';
    const params = new URLSearchParams({ api: '1', origin: o, destination: d });
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  get routeSummary(): string {
    const stops = this.sortedStops;
    if (!stops || stops.length < 2) return '';
    const origin = stops[0];
    const dest = stops[stops.length - 1];
    const o = [origin.city, origin.state].filter(Boolean).join(', ');
    const d = [dest.city, dest.state].filter(Boolean).join(', ');
    return o && d ? `${o} → ${d}` : '';
  }

  /** Driver position = from loads API (position before picking up this load), else previous delivery, else fallback to last delivery stop. */
  get driverPositionDisplay(): string {
    const load = this.editingLoadDetail;
    const city = (load?.driver_position_city || '').toString().trim();
    const state = (load?.driver_position_state || '').toString().trim();
    if (city || state) return [city || '--', state].filter(Boolean).join(', ');
    const prevCity = (load?.prev_delivery_city || '').toString().trim();
    const prevState = (load?.prev_delivery_state || '').toString().trim();
    if (prevCity || prevState) {
      const location = [prevCity || '--', prevState].filter(Boolean).join(', ');
      return `Last delivery: ${location}`;
    }
    const stops = this.sortedStops || [];
    if (!stops.length) return '--';
    const lastDelivery = [...stops].reverse().find(
      (s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY'
    );
    const stop = lastDelivery || stops[stops.length - 1];
    return [stop.city || '--', stop.state || ''].filter(Boolean).join(', ');
  }

  /** True if the datetime has a non‑midnight time component; otherwise treat it as date‑only. */
  hasTimePart(value: unknown): boolean {
    if (!value) return false;
    const d = value instanceof Date ? value : new Date(value as any);
    if (Number.isNaN(d.getTime())) return false;
    return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  }

  /** Pickup/delivery date for a stop: match Edit Load form (form value first), then stop date, then load from API. */
  getStopDisplayDate(stop: LoadStop, _index: number): string | null {
    const load = this.editingLoadDetail;
    const type = (stop?.stop_type || '').toString().toUpperCase();
    const formPickup = this.manualLoadForm.get('pickupDate')?.value;
    const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
    if (type === 'PICKUP') {
      const v = (stop?.stop_date ?? formPickup ?? load?.pickup_date) ?? null;
      return v ? String(v).trim() || null : null;
    }
    if (type === 'DELIVERY') {
      const v = (stop?.stop_date ?? formDelivery ?? load?.delivery_date) ?? null;
      return v ? String(v).trim() || null : null;
    }
    return (stop?.stop_date as string) || null;
  }

  constructor(
    private loadsService: LoadsService,
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
    private operatingEntityContext: OperatingEntityContextService,
    private loadTemplatesService: LoadTemplatesService,
    private keyboardShortcuts: KeyboardShortcutsService,
    private userPreferences: UserPreferencesService,
    private scrollStrategies: ScrollStrategyOptions
  ) {
    // Close the inline menu when any ancestor scrolls — the virtual-scroll
    // viewport may recycle the trigger row while the menu is open.
    this.inlineMenuScrollStrategy = this.scrollStrategies.close();
    this.manualLoadForm = this.fb.group({
      status: ['NEW', Validators.required],
      billingStatus: ['PENDING', Validators.required],
      dispatcher: [{ value: '', disabled: true }],
      pickupDate: ['', Validators.required],
      pickupCity: [''],
      pickupState: [''],
      pickupZip: [''],
      deliveryDate: ['', Validators.required],
      deliveryCity: [''],
      deliveryState: [''],
      deliveryZip: [''],
      driverId: [''],
      truckId: [''],
      trailerId: [''],
      brokerId: [''],
      brokerName: [''],
      poNumber: [''],
      rate: ['', [Validators.required, Validators.pattern(/^\d+(\.\d{1,2})?$/)]],
      notes: ['']
    });
    this.newStopForm = this.fb.group({
      stopType: ['DELIVERY'],
      orderAfterIndex: [0],
      stopDate: ['', Validators.required],
      company: [''],
      address1: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: [''],
      phone: [''],
      notes: ['']
    });
    this.editStopForm = this.fb.group({
      stopType: ['PICKUP'],
      orderAfterIndex: [0],
      appointmentType: ['FCFS'],
      stopDate: ['', Validators.required],
      apptTime: [''],
      company: [''],
      address1: [''],
      city: ['', Validators.required],
      state: ['', Validators.required],
      zip: [''],
      phone: [''],
      notes: ['']
    });
    this.brokerCreateForm = this.fb.group({
      companyName: ['', Validators.required],
      address: [''],
      address2: [''],
      city: [''],
      state: [''],
      zip: [''],
      phone: [''],
      email: [''],
      mc_number: [''],
      dot_number: [''],
      notes: ['']
    });
  }

  private normalizeDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  /** Format date string as yyyy-MM-dd using local parsing to avoid UTC shift. */
  formatDateLocal(value: string | null | undefined): string {
    if (!value) return '';
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
      return isNaN(d.getTime()) ? '' : `${m[1]}-${m[2]}-${m[3]}`;
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.route.queryParams.subscribe((params) => {
      if (params['status']) this.filters.status = params['status'];
      if (params['billingStatus']) this.filters.billingStatus = params['billingStatus'];
      const loadId = params['loadId'];
      if (loadId) {
        this.loadsService.getLoad(loadId).subscribe({
          next: (res) => {
            this.selectedLoad = res?.data || null;
            this.showDetailsModal = true;
          }
        });
      }
    });
    this.statusFilterOptions = this.statusOptions.map(s => ({ value: s, label: this.getStatusLabel(s) }));
    this.billingFilterOptions = this.billingOptions.map(b => ({ value: b, label: this.getBillingLabel(b) }));
    this.initColumnVisibility();
    this.loadDropdownData();
    this.loadLoads();
    this.applyUseTemplateFromRouterState();
    this.registerKeyboardShortcuts();
    this.loadUserPreferences();

    this.search$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((value) => {
        this.filters.q = value;
        this.page = 1;
        this.loadLoads();
      });

    this.brokerSearch$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((q) => {
          this.brokerSearchLoading = true;
          return this.loadsService.getBrokers(q).pipe(
            catchError(() => of({ data: [] })),
            map((res) => ({ data: res?.data || [] }))
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((res) => {
        this.brokerSearchResults = res.data;
        this.brokers = this.brokerSearchResults.map((b) => ({
          id: b.id,
          name: this.getBrokerDisplayName(b)
        }));
        this.brokerSearchLoading = false;
      });
  }

  ngOnDestroy(): void {
    if (this._unregisterShortcuts) {
      this._unregisterShortcuts();
      this._unregisterShortcuts = null;
    }
    // FN-821: release timers held by the filter-pulse and new-AI-glow effects.
    if (this.filterPulseTimer) {
      clearTimeout(this.filterPulseTimer);
      this.filterPulseTimer = null;
    }
    if (this.newAiGlowTimer) {
      clearTimeout(this.newAiGlowTimer);
      this.newAiGlowTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── FN-765: Keyboard shortcuts ─────────────────────────────────────────────

  /**
   * Register Loads-view shortcuts via KeyboardShortcutsService. Bindings are
   * unregistered in ngOnDestroy so they don't leak to other views.
   */
  private registerKeyboardShortcuts(): void {
    if (this._unregisterShortcuts) { return; }
    this._unregisterShortcuts = this.keyboardShortcuts.registerAll([
      {
        id: 'loads.new',
        key: 'n',
        description: 'New load',
        group: 'Loads',
        handler: () => this.openLoadWizard(),
      },
      {
        id: 'loads.quickSearch',
        key: 'k',
        ctrlOrCmd: true,
        allowInInput: true,
        description: 'Quick search loads',
        group: 'Loads',
        handler: () => this.focusSearch(),
      },
      {
        id: 'loads.focusSearch',
        key: '/',
        description: 'Focus search bar',
        group: 'Loads',
        handler: () => this.focusSearch(),
      },
    ]);
    // Wizard-specific shortcuts (Esc, Cmd+S, Cmd+Shift+S, Enter) are owned by
    // LoadWizardComponent so they only appear in the help modal when the
    // wizard is open.
  }

  /** Focus and select the contents of the header search input. */
  focusSearch(): void {
    const el = this.searchInputRef?.nativeElement;
    if (!el) { return; }
    el.focus();
    try { el.select(); } catch { /* some browsers throw on non-text inputs */ }
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.selectedLoad = null;
          this.showDetailsModal = false;
          this.editingLoadDetail = null;
          this.editingLoadId = null;
          this.page = 1;
          this.loadLoads();
        }
      });
  }

  loadDropdownData(): void {
    this.loadsService.getActiveDrivers().subscribe({
      next: (data) => {
        this.drivers = (data || []).map((driver) => ({
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`.trim(),
          truckId: driver.truckId || null,
          trailerId: driver.trailerId || null
        }));
        this.driverFilterOptions = this.drivers.map(d => ({ value: d.id, label: d.name }));
      },
      error: () => {
        this.drivers = [];
        this.driverFilterOptions = [];
      }
    });

    this.loadsService.getEquipment('truck').subscribe({
      next: (res) => {
        this.trucks = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trucks = [];
      }
    });

    this.loadsService.getEquipment('trailer').subscribe({
      next: (res) => {
        this.trailers = (res?.data || []).map((vehicle) => ({
          id: vehicle.id,
          label: `${vehicle.unit_number} (${vehicle.make || ''} ${vehicle.model || ''})`.trim()
        }));
      },
      error: () => {
        this.trailers = [];
      }
    });

    this.loadsService.getCurrentUser().subscribe({
      next: (res) => {
        const user = res?.data;
        const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
        this.dispatcherName = name || user?.username || '';
        this.dispatcherUserId = user?.id || null;
        this.manualLoadForm.patchValue({ dispatcher: this.dispatcherName });
        const role = (user?.role || '').toString().toLowerCase();
        if (role === 'driver' && user?.driver_id) {
          this.isDriverRole = true;
          this.filters.driverId = user.driver_id;
          this.loadLoads();
        }
      }
    });
  }

  loadBrokers(): void {
    this.brokerSearch$.next((this.manualLoadForm.get('brokerName')?.value || '').toString().trim());
  }

  /** Emit broker search query (debounced; switchMap cancels in-flight). */
  searchBrokers(): void {
    const q = (this.manualLoadForm.get('brokerName')?.value || '').toString().trim();
    this.brokerSearch$.next(q);
  }

  getBrokerDisplayName(b: BrokerOption): string {
    return (b.display_name || b.name || b.legal_name || '').toString().trim() || '—';
  }

  /** One-line display for broker in dropdown: "Name / City, ST / MC". */
  getBrokerDisplayLine(b: BrokerOption): string {
    const name = this.getBrokerDisplayName(b);
    const loc = [b.city, b.state].filter(Boolean).join(', ');
    const mc = (b.mc_number || '').toString().trim();
    if (loc && mc) return `${name} / ${loc} / ${mc}`;
    if (loc) return `${name} / ${loc}`;
    if (mc) return `${name} / ${mc}`;
    return name;
  }

  get filteredBrokers(): { id: string; name: string }[] {
    return this.brokerSearchResults.map((b) => ({
      id: b.id,
      name: this.getBrokerDisplayLine(b)
    }));
  }

  selectBroker(broker: { id: string; name: string } | BrokerOption): void {
    const id = 'id' in broker ? broker.id : (broker as BrokerOption).id;
    const name = 'name' in broker && (broker as { name: string }).name
      ? (broker as { name: string }).name
      : this.getBrokerDisplayName(broker as BrokerOption);
    this.manualLoadForm.patchValue({ brokerId: id, brokerName: name });
    this.brokerDropdownOpen = false;
  }

  onBrokerInputFocus(): void {
    this.brokerDropdownOpen = true;
    this.searchBrokers();
  }

  onBrokerSearchInput(): void {
    this.searchBrokers();
  }

  openNewBrokerModal(): void {
    const current = (this.manualLoadForm.get('brokerName')?.value || '').toString().trim();
    this.brokerCreateForm.patchValue({
      companyName: current || '',
      address: '',
      address2: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      email: '',
      mc_number: '',
      dot_number: '',
      notes: ''
    });
    this.brokerCreateError = '';
    this.showBrokerCreateModal = true;
    this.brokerDropdownOpen = false;
  }

  closeBrokerCreateModal(): void {
    this.showBrokerCreateModal = false;
    this.brokerCreateError = '';
  }

  saveNewBroker(): void {
    if (this.brokerCreateForm.invalid) {
      this.brokerCreateError = 'Company name is required.';
      return;
    }
    const v = this.brokerCreateForm.value;
    this.brokerCreateSaving = true;
    this.brokerCreateError = '';
    this.loadsService.createBroker({
      legal_name: v.companyName,
      companyName: v.companyName,
      street: v.address,
      address: v.address,
      city: v.city,
      state: v.state,
      zip: v.zip,
      phone: v.phone,
      email: v.email,
      mc_number: v.mc_number,
      dot_number: v.dot_number,
      notes: v.notes
    }).subscribe({
      next: (res) => {
        this.brokerCreateSaving = false;
        const created = res?.data;
        if (created) {
          this.brokerSearchResults = [created, ...this.brokerSearchResults];
          this.selectBroker(created);
        }
        this.closeBrokerCreateModal();
      },
      error: (err) => {
        this.brokerCreateSaving = false;
        this.brokerCreateError = err?.error?.error || 'Failed to create broker.';
      }
    });
  }

  get inlineFilteredDrivers(): { id: string; name: string }[] {
    const q = this.driverSearch.trim().toLowerCase();
    if (!q) return this.drivers.slice(0, 50);
    return this.drivers.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 50);
  }

  get inlineFilteredTrucks(): { id: string; label: string }[] {
    const q = this.truckSearch.trim().toLowerCase();
    if (!q) return this.trucks.slice(0, 50);
    return this.trucks.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 50);
  }

  get inlineFilteredTrailers(): { id: string; label: string }[] {
    const q = this.trailerSearch.trim().toLowerCase();
    if (!q) return this.trailers.slice(0, 50);
    return this.trailers.filter((t) => t.label.toLowerCase().includes(q)).slice(0, 50);
  }

  selectInlineDriver(driver: { id: string; name: string; truckId?: string | null; trailerId?: string | null }): void {
    this.manualLoadForm.patchValue({ driverId: driver.id });
    this.driverSearch = driver.name;
    this.driverDropdownOpen = false;
    // FN-545: auto-fill truck and trailer from driver's current dispatch assignment
    const cached = this.drivers.find(d => d.id === driver.id);
    if (cached?.truckId) {
      this.manualLoadForm.patchValue({ truckId: cached.truckId });
      const truck = this.trucks.find(t => t.id === cached.truckId);
      if (truck) this.truckSearch = truck.label;
    }
    if (cached?.trailerId) {
      this.manualLoadForm.patchValue({ trailerId: cached.trailerId });
      const trailer = this.trailers.find(t => t.id === cached.trailerId);
      if (trailer) this.trailerSearch = trailer.label;
    }
  }

  selectInlineTruck(truck: { id: string; label: string }): void {
    this.manualLoadForm.patchValue({ truckId: truck.id });
    this.truckSearch = truck.label;
    this.truckDropdownOpen = false;
  }

  selectInlineTrailer(trailer: { id: string; label: string }): void {
    this.manualLoadForm.patchValue({ trailerId: trailer.id });
    this.trailerSearch = trailer.label;
    this.trailerDropdownOpen = false;
  }

  loadLoads(): void {
    this.loading = true;
    this.errorMessage = '';
    this.loadError = false;
    this.permissionDenied = false;
    this.loadErrorDetail = '';
    this.triggerFilterPulse();
    const range = this.getGrossPeriodDateRange();
    this.loadsService
      .listLoads({
        status: this.filters.status,
        billingStatus: this.filters.billingStatus,
        driverId: this.filters.driverId,
        q: this.filters.q,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        page: this.page,
        pageSize: this.pageSize,
        sortBy: this.sortBy,
        sortDir: this.sortDir,
        needsReview: this.filters.needsReview || undefined,
        source: this.filters.source || undefined,
        smartFilter: this.smartFilterKeys.length ? this.smartFilterKeys : undefined
      })
      .subscribe({
        next: (res) => {
          this.loads = res?.data || [];
          this.total = res?.meta?.total || 0;
          this.loading = false;
          this.trackNewAiLoads(this.loads);
        this.recomputeSummaryTotals();
        this.recomputeIntelligenceMetrics();
        },
        error: (err: any) => {
          this.loadError = true;
          this.permissionDenied = err?.status === 403;
          this.loadErrorDetail = err?.error?.error || err?.message || '';
          // FN-821: empty-state card carries the user-visible retry CTA —
          // suppress the redundant transient toast.
          this.errorMessage = '';
          this.loading = false;
        }
      });
    // FN-798: refresh chip counts alongside the list so badges stay in sync
    // with the underlying data (counts are tenant/OE/driver-scoped, not filter-scoped).
    this.loadSmartFilterCounts();
  }

  /** FN-798: pull per-chip counts. Non-blocking; failure silently leaves stale counts. */
  private loadSmartFilterCounts(): void {
    this.smartFilterCountsLoading = true;
    this.loadsService.getSmartFilterCounts().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.smartFilterCounts = res?.data || null;
        this.smartFilterCountsLoading = false;
      },
      error: () => {
        this.smartFilterCountsLoading = false;
      }
    });
  }

  /** FN-798: toggle a smart-filter chip. Multiple active chips AND together. */
  toggleSmartFilter(key: SmartFilterKey): void {
    if (!SMART_FILTER_KEYS.includes(key)) return;
    const idx = this.smartFilterKeys.indexOf(key);
    if (idx >= 0) {
      this.smartFilterKeys = this.smartFilterKeys.filter((k) => k !== key);
    } else {
      this.smartFilterKeys = [...this.smartFilterKeys, key];
    }
    this.page = 1;
    this.loadLoads();
  }

  /** FN-798: clear every active smart-filter chip and reload the list. */
  clearSmartFilters(): void {
    if (!this.smartFilterKeys.length) return;
    this.smartFilterKeys = [];
    this.page = 1;
    this.loadLoads();
  }

  onSearch(value: string): void {
    this.search$.next(value);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadLoads();
  }

  toggleSort(field: 'load_number' | 'pickup_date' | 'rate' | 'completed_date'): void {
    if (this.sortBy === field) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortDir = 'asc';
    }
    this.loadLoads();
  }

  setStatusFilter(value: string): void {
    this.filters.status = value;
    this.page = 1;
    this.loadLoads();
  }

  /** FN-746: toggle the Needs Review filter chip. */
  toggleNeedsReview(): void {
    this.filters.needsReview = !this.filters.needsReview;
    this.page = 1;
    this.loadLoads();
  }

  /** FN-762: toggle the "Source: Email" filter chip. */
  toggleEmailSource(): void {
    this.filters.source = this.filters.source === 'email' ? '' : 'email';
    this.page = 1;
    this.loadLoads();
  }

  setBillingFilter(value: string): void {
    this.filters.billingStatus = value;
    this.page = 1;
    this.loadLoads();
  }

  onGrossPeriodChange(): void {
    this.page = 1;
    this.loadLoads();
  }

  setGrossPeriod(value: string): void {
    this.grossPeriod = value;
    this.page = 1;
    this.loadLoads();
  }

  getGrossPeriodDateRange(): { dateFrom?: string; dateTo?: string } {
    const now = new Date();
    const toStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    switch (this.grossPeriod) {
      case 'all':
        return {};
      case 'today': {
        const d = new Date(now);
        return { dateFrom: toStr(d), dateTo: toStr(d) };
      }
      case 'yesterday': {
        const d = new Date(now);
        d.setDate(d.getDate() - 1);
        return { dateFrom: toStr(d), dateTo: toStr(d) };
      }
      case 'this_week': {
        const sun = new Date(now);
        sun.setDate(sun.getDate() - sun.getDay());
        const sat = new Date(sun);
        sat.setDate(sat.getDate() + 6);
        return { dateFrom: toStr(sun), dateTo: toStr(sat) };
      }
      case 'last_week': {
        const sun = new Date(now);
        sun.setDate(sun.getDate() - sun.getDay() - 7);
        const sat = new Date(sun);
        sat.setDate(sat.getDate() + 6);
        return { dateFrom: toStr(sun), dateTo: toStr(sat) };
      }
      case 'last_7_days': {
        const from = new Date(now);
        from.setDate(from.getDate() - 6);
        return { dateFrom: toStr(from), dateTo: toStr(now) };
      }
      case 'last_30_days': {
        const from = new Date(now);
        from.setDate(from.getDate() - 29);
        return { dateFrom: toStr(from), dateTo: toStr(now) };
      }
      case 'this_month': {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { dateFrom: toStr(first), dateTo: toStr(last) };
      }
      case 'last_month': {
        const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const last = new Date(now.getFullYear(), now.getMonth(), 0);
        return { dateFrom: toStr(first), dateTo: toStr(last) };
      }
      case 'last_3_months': {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 2);
        from.setDate(1);
        return { dateFrom: toStr(from), dateTo: toStr(now) };
      }
      case 'last_6_months': {
        const from = new Date(now);
        from.setMonth(from.getMonth() - 5);
        from.setDate(1);
        return { dateFrom: toStr(from), dateTo: toStr(now) };
      }
      case 'this_year': {
        const first = new Date(now.getFullYear(), 0, 1);
        const last = new Date(now.getFullYear(), 11, 31);
        return { dateFrom: toStr(first), dateTo: toStr(last) };
      }
      case 'last_year': {
        const y = now.getFullYear() - 1;
        const first = new Date(y, 0, 1);
        const last = new Date(y, 11, 31);
        return { dateFrom: toStr(first), dateTo: toStr(last) };
      }
      default:
        return {};
    }
  }

  goToPage(page: number): void {
    if (page < 1) return;
    const maxPage = Math.max(Math.ceil(this.total / this.pageSize), 1);
    if (page > maxPage) return;
    this.page = page;
    this.loadLoads();
  }

  openManualEntry(): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.attachmentTab = 'documents';
    // Fresh manual entry should not carry over any pending attachments
    this.pendingAttachments = [];
    this.attachmentNotes = '';
    this.attachmentType = 'RATE_CONFIRMATION';
    this.attachmentError = '';
    this.selectedAttachmentFiles = null;
    this.resetManualForm();
    this.loadBrokers();
    this.showManualModal = false;
    this.showInlineNewLoad = true;
    this.showNewLoadMenu = false;
  }

  openAutoCreate(): void {
    this.autoPdfFile = null;
    this.autoExtracting = false;
    this.autoError = '';
    this.autoExtraction = null;
    this.showAutoModal = true;
    this.showNewLoadMenu = false;
  }

  // ─── Load Wizard methods (FN-732) ─────────────────────────────────────────

  /** Open the 4-step load creation wizard (replaces the inline new-load form). */
  openLoadWizard(): void {
    this.wizardActiveStep = 0;
    this.wizardStepValid = [false, false, false, false];
    this.wizardDirty = false;
    this.resetWizardFormState();
    this.applySmartDefaults();
    this.showLoadWizard = true;
    this.showNewLoadMenu = false;
  }

  /**
   * FN-764: Pre-fill smart defaults on new loads.
   *  - Dispatcher = current user
   *  - Status = DRAFT, Billing = PENDING (already set in defaultBasics)
   *  - Pickup = today, Delivery = today + 1
   *  - Driver = most-recent driver per dispatcher (from UserPreferencesService)
   */
  private applySmartDefaults(): void {
    this.wizardBasics = {
      ...this.wizardBasics,
      dispatcher: this.dispatcherName || this.wizardBasics.dispatcher || ''
    };

    const pickupIso = this.formatLocalDate(new Date());
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    const deliveryIso = this.formatLocalDate(deliveryDate);

    this.wizardStops = this.wizardStops.map((stop) => {
      if (stop.stop_type === 'PICKUP' && !stop.stop_date) {
        return { ...stop, stop_date: pickupIso };
      }
      if (stop.stop_type === 'DELIVERY' && !stop.stop_date) {
        return { ...stop, stop_date: deliveryIso };
      }
      return stop;
    });
    if (!this.wizardStops.length) {
      this.wizardStops = [
        {
          stop_type: 'PICKUP', sequence: 0,
          city: null, state: null, zip: null,
          stop_date: pickupIso, stop_time: null,
          facility_name: null, notes: null
        },
        {
          stop_type: 'DELIVERY', sequence: 1,
          city: null, state: null, zip: null,
          stop_date: deliveryIso, stop_time: null,
          facility_name: null, notes: null
        }
      ];
    }

    const recentDriverId = this.userPreferences.getRecentDriverId(this.dispatcherUserId);
    if (recentDriverId) {
      this.wizardDriverId = recentDriverId;
    }
  }

  /** Format a Date as "YYYY-MM-DD" in local time (avoids UTC off-by-one). */
  private formatLocalDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * FN-749: Open the wizard in edit mode with data pre-filled from an existing load.
   * All steps are freely jumpable — no step validation gating.
   */
  openLoadWizardForEdit(loadId: string): void {
    this.wizardEditMode = true;
    this.wizardEditLoadId = loadId;
    this.wizardActiveStep = 0;
    this.wizardStepValid = [true, true, true, true]; // all valid — existing load
    this.wizardDirty = false;
    this.showLoadWizard = true;

    // Load the existing load detail and pre-fill wizard data
    this.loadsService.getLoad(loadId).subscribe({
      next: (res: any) => {
        const load = res?.data || res;
        this.wizardPrefilledData = load;
      },
      error: () => {
        this.wizardPrefilledData = null;
      }
    });
  }

  // ─── Load Templates (FN-755) ───────────────────────────────────────────

  /** Navigate to the Load Templates admin page. */
  navigateToTemplates(): void {
    this.router.navigate(['/loads/templates']);
  }

  /**
   * Open the Save-As-Template prompt for the given load ID.
   * Defaults to the currently-open editing load when no id is passed.
   */
  openSaveAsTemplateModal(loadId?: string): void {
    const id = loadId ?? this.editingLoadId;
    if (!id) return;
    this.saveAsTemplateLoadId = id;
    this.saveAsTemplateName = '';
    this.saveAsTemplateDescription = '';
    this.saveAsTemplateError = '';
    this.saveAsTemplateSubmitting = false;
    this.showSaveAsTemplateModal = true;
  }

  closeSaveAsTemplateModal(): void {
    if (this.saveAsTemplateSubmitting) return;
    this.showSaveAsTemplateModal = false;
    this.saveAsTemplateLoadId = null;
    this.saveAsTemplateError = '';
  }

  submitSaveAsTemplate(): void {
    const name = (this.saveAsTemplateName || '').trim();
    if (!this.saveAsTemplateLoadId) return;
    if (!name) {
      this.saveAsTemplateError = 'Name is required.';
      return;
    }
    this.saveAsTemplateSubmitting = true;
    this.saveAsTemplateError = '';
    this.loadTemplatesService.create({
      load_id: this.saveAsTemplateLoadId,
      name,
      description: (this.saveAsTemplateDescription || '').trim() || null
    }).subscribe({
      next: () => {
        this.saveAsTemplateSubmitting = false;
        this.showSaveAsTemplateModal = false;
        this.saveAsTemplateLoadId = null;
        this.successMessage = `Template "${name}" saved.`;
        setTimeout(() => (this.successMessage = ''), 3500);
      },
      error: (err) => {
        this.saveAsTemplateSubmitting = false;
        const serverMsg = err?.error?.error || err?.error?.message;
        this.saveAsTemplateError = serverMsg || 'Failed to save template.';
      }
    });
  }

  /**
   * Apply template data to the inline new-load form.
   * Dates are intentionally NOT pre-filled — templates are reusable snapshots
   * that should prompt the user to set new dates for each trip.
   */
  private applyTemplateToManualForm(data: any): void {
    if (!data) return;
    this.openManualEntry();

    const stops: LoadStop[] = Array.isArray(data?.stops) ? data.stops : [];
    const firstPickup = stops.find(s => (s.stop_type || '').toUpperCase() === 'PICKUP') || stops[0] || {} as LoadStop;
    const lastDelivery = [...stops].reverse().find(s => (s.stop_type || '').toUpperCase() === 'DELIVERY') || stops[stops.length - 1] || {} as LoadStop;

    this.manualLoadForm.patchValue({
      status: 'DRAFT',
      billingStatus: 'PENDING',
      brokerId: data.broker_id || '',
      brokerName: data.broker_name || data.broker_display_name || '',
      driverId: data.driver_id || '',
      truckId: data.truck_id || '',
      trailerId: data.trailer_id || '',
      rate: data.rate != null ? data.rate : '',
      notes: data.notes || '',
      pickupCity: firstPickup?.city || '',
      pickupState: firstPickup?.state || '',
      pickupZip: firstPickup?.zip || '',
      deliveryCity: lastDelivery?.city || '',
      deliveryState: lastDelivery?.state || '',
      deliveryZip: lastDelivery?.zip || ''
    });

    if (stops.length > 2) {
      this.sortedStops = stops.map((s, i) => ({
        stop_type: (s.stop_type as 'PICKUP' | 'DELIVERY') || (i === 0 ? 'PICKUP' : 'DELIVERY'),
        stop_date: null,
        city: s.city || null,
        state: s.state || null,
        zip: s.zip || null,
        address1: s.address1 || null,
        sequence: s.sequence ?? i + 1
      })).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }
  }

  /** If the current router navigation carried a `useTemplate` state, pre-fill the form. */
  private applyUseTemplateFromRouterState(): void {
    const state = (typeof history !== 'undefined' ? history.state : null) as any;
    const useTemplate = state?.useTemplate;
    if (!useTemplate?.data) return;
    this.applyTemplateToManualForm(useTemplate.data);
    this.successMessage = `Using template "${useTemplate.name || 'load template'}". Dates and PO were cleared — fill them in and save.`;
    // Clear the state so a browser back/forward doesn't re-trigger this.
    try { history.replaceState({}, '', window.location.pathname + window.location.search); } catch { /* noop */ }
    setTimeout(() => (this.successMessage = ''), 6000);
  }

  /** Close the wizard and reset its state. */
  closeWizard(): void {
    this.showLoadWizard = false;
    this.wizardActiveStep = 0;
    this.wizardDirty = false;
    this.wizardEditMode = false;
    this.wizardEditLoadId = null;
    this.wizardPrefilledData = null;
  }

  /** Called when the wizard emits (save). Creates the load and closes the wizard. */
  onWizardSave(): void {
    // Step implementations (FN-733 through FN-736) will call createLoad() here.
    // For now the save event closes the wizard as a placeholder.
    this.closeWizard();
  }

  /** Called when the wizard emits (saveAndNew). Creates the load and resets to step 0. */
  onWizardSaveAndNew(): void {
    // Step implementations will call createLoad() then reset wizard state.
    this.wizardActiveStep = 0;
    this.wizardStepValid = [false, false, false, false];
    this.wizardDirty = false;
    this.resetWizardFormState();
  }

  // ─── FN-778: Wizard step bindings ────────────────────────────────────────

  onWizardBasicsChange(data: StepBasicsData): void {
    this.wizardBasics = data;
    this.wizardDirty = true;
  }

  onWizardBasicsValid(valid: boolean): void {
    this.wizardStepValid = this.updateStepValid(0, valid);
  }

  onWizardStopsChange(stops: LoadStop[]): void {
    this.wizardStops = stops;
    this.wizardDirty = true;
  }

  onWizardStopsValid(valid: boolean): void {
    this.wizardStepValid = this.updateStepValid(1, valid);
  }

  onWizardDriverChange(driverId: string | null): void {
    this.wizardDriverId = driverId;
    this.wizardDirty = true;
    // FN-764: remember so next "New Load" suggests this driver by default.
    if (driverId) {
      this.userPreferences.setRecentDriverId(this.dispatcherUserId, driverId);
    }
  }

  onWizardTruckChange(truckId: string | null): void {
    this.wizardTruckId = truckId;
    this.wizardDirty = true;
  }

  onWizardTrailerChange(trailerId: string | null): void {
    this.wizardTrailerId = trailerId;
    this.wizardDirty = true;
  }

  onWizardDriverValid(valid: boolean): void {
    this.wizardStepValid = this.updateStepValid(2, valid);
  }

  onWizardAttachmentsChange(attachments: WizardAttachment[]): void {
    this.wizardAttachments = attachments;
    this.wizardDirty = true;
  }

  private updateStepValid(index: number, valid: boolean): boolean[] {
    const next = [...this.wizardStepValid];
    next[index] = valid;
    return next;
  }

  private resetWizardFormState(): void {
    this.wizardBasics = this.defaultBasics();
    this.wizardStops = [];
    this.wizardDriverId = null;
    this.wizardTruckId = null;
    this.wizardTrailerId = null;
    this.wizardAttachments = [];
    this.wizardAiExtractedPdf = null;
    this.wizardAiPrefilledFields = new Set();
  }

  private defaultBasics(): StepBasicsData {
    return {
      loadNumber: '',
      // FN-764: new loads default to DRAFT / PENDING so dispatchers can
      // capture-first-refine-later without accidentally advancing lifecycle.
      status: 'DRAFT',
      billingStatus: 'PENDING',
      brokerId: null,
      brokerName: '',
      poNumber: '',
      rate: null,
      dispatcher: '',
      notes: ''
    };
  }

  openBulkUpload(): void {
    this.bulkPdfFiles = [];
    this.bulkUploading = false;
    this.bulkError = '';
    this.bulkResults = [];
    this.showBulkUploadModal = true;
    this.showNewLoadMenu = false;
  }

  // ─── Hero CTA handlers (FN-743) ────────────────────────────────────────

  /** Single PDF selected from hero upload zone — pre-fills the auto-create modal. */
  onHeroSinglePdf(file: File): void {
    this.autoPdfFile = file;
    this.autoExtracting = false;
    this.autoError = '';
    this.autoExtraction = null;
    this.showAutoModal = true;
  }

  /** Multiple PDFs selected from hero upload zone — pre-fills the bulk upload modal. */
  onHeroBulkPdfs(files: File[]): void {
    this.bulkPdfFiles = files.slice(0, 10);
    this.bulkUploading = false;
    this.bulkError = '';
    this.bulkResults = [];
    this.showBulkUploadModal = true;
  }

  /**
   * Clone Existing Load — stub until the clone API endpoint is built.
   * Will open a search/select dialog to pick the source load.
   */
  openCloneLoad(): void {
    // TODO: open clone-load dialog when backend endpoint lands (FN-724 sibling subtask)
    this.successMessage = '';
    this.errorMessage = 'Clone load is coming soon.';
    setTimeout(() => { this.errorMessage = ''; }, 3000);
  }

  closeBulkUploadModal(): void {
    this.showBulkUploadModal = false;
    this.bulkPdfFiles = [];
    this.bulkResults = [];
  }

  // ─── FN-745: Bulk Extraction Grid ─────────────────────────────────────
  openBulkExtractionGrid(files: File[]): void {
    const pdfs = files.filter((f) => f.type === 'application/pdf');
    if (pdfs.length < 2 || pdfs.length > 10) return;
    this.bulkExtractionFiles = pdfs;
    this.showBulkExtractionGrid = true;
  }

  closeBulkExtractionGrid(): void {
    this.showBulkExtractionGrid = false;
    this.bulkExtractionFiles = [];
    this.loadLoads();
  }

  onBulkExtractionReviewNow(): void {
    this.showBulkExtractionGrid = false;
    this.bulkExtractionFiles = [];
    // Reload the list filtered to drafts needing review
    this.filters.status = 'DRAFT';
    this.page = 1;
    this.loadLoads();
  }

  onBulkFilesSelected(files: FileList | null, inputEl?: HTMLInputElement): void {
    this.bulkError = '';
    if (!files || files.length === 0) return;
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (files.length > 0 && pdfs.length === 0) {
      this.bulkError = 'Please select PDF files only.';
      return;
    }
    const maxTotal = 10;
    const current = this.bulkPdfFiles.length;
    const remaining = Math.max(0, maxTotal - current);
    if (remaining === 0) {
      this.bulkError = 'Maximum 10 rate confirmations. Remove one to add more.';
      return;
    }
    const toAdd = pdfs.slice(0, remaining);
    this.bulkPdfFiles = [...this.bulkPdfFiles, ...toAdd];
    if (pdfs.length > remaining) {
      this.bulkError = `Added ${toAdd.length} file(s). Maximum 10 total; ${pdfs.length - remaining} not added.`;
    }
    if (inputEl) inputEl.value = '';
  }

  removeBulkFile(index: number): void {
    this.bulkError = '';
    this.bulkPdfFiles = this.bulkPdfFiles.filter((_, i) => i !== index);
  }

  onBulkDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) this.onBulkFilesSelected(files);
  }

  runBulkUpload(): void {
    this.bulkError = '';
    if (this.bulkPdfFiles.length === 0) {
      this.bulkError = 'Please select at least one PDF file.';
      return;
    }
    const filesToUpload = [...this.bulkPdfFiles];
    this.bulkUploading = true;
    this.bulkResults = [];
    this.closeBulkUploadModal();
    this.errorMessage = '';
    this.successMessage = 'Extracting load details… we\'ll notify when ready.';
    const fileCount = filesToUpload.length;
    this.loadsService.bulkUploadRateConfirmations(filesToUpload).subscribe({
      next: (res) => {
        this.bulkUploading = false;
        this.bulkResults = res?.results || [];
        const successCount = this.bulkResults.filter((r) => r.success).length;
        const failCount = this.bulkResults.length - successCount;
        this.errorMessage = '';
        if (successCount > 0) {
          this.loadLoads();
          this.successMessage =
            successCount === fileCount
              ? `${successCount} load(s) extracted and ready for review.`
              : `${successCount} load(s) extracted.${failCount > 0 ? ` ${failCount} failed.` : ''}`;
        } else {
          this.errorMessage = failCount > 0
            ? (this.bulkResults[0]?.error || 'Extraction failed for all files.')
            : 'Bulk upload failed.';
        }
        setTimeout(() => {
          this.successMessage = '';
          this.errorMessage = '';
        }, 5000);
      },
      error: (err) => {
        this.bulkUploading = false;
        this.successMessage = '';
        this.errorMessage = err?.error?.error || 'Extraction failed. Please try again.';
        setTimeout(() => { this.errorMessage = ''; }, 5000);
      }
    });
  }

  approveDraftLoad(load: LoadListItem, e?: Event): void {
    if (e) e.stopPropagation();
    const status = (load.status || '').toString().toUpperCase();
    if (status !== 'DRAFT') return;
    this.errorMessage = '';

    // When approving from the detail modal, send current form state so edits are persisted
    let body: Record<string, unknown> = {};
    if (this.editingLoadId && this.editingLoadDetail) {
      const formValue = this.manualLoadForm.getRawValue();
      const stops: LoadStop[] = this.sortedStops?.length
        ? this.sortedStops.map((s, i) => ({ ...s, sequence: i + 1 }))
        : [];
      body = {
        billingStatus: formValue.billingStatus || null,
        dispatcherUserId: this.dispatcherUserId,
        driverId: formValue.driverId || null,
        truckId: formValue.truckId || null,
        trailerId: formValue.trailerId || null,
        brokerId: formValue.brokerId || null,
        brokerName: formValue.brokerName || null,
        poNumber: formValue.poNumber || null,
        rate: formValue.rate ? Number(formValue.rate) : 0,
        notes: formValue.notes || null,
        stops
      };
    }

    this.loadsService.approveDraft(load.id, body).subscribe({
      next: () => {
        this.successMessage = 'Load approved.';
        this.closeManualModal();
        this.loadLoads();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to approve load.';
      }
    });
  }

  deleteDraftLoad(load: LoadListItem | LoadDetail): void {
    const id = load.id;
    if (!id) return;
    if ((load as LoadListItem).status && (load as LoadListItem).status.toString().toUpperCase() !== 'DRAFT') return;
    if (!confirm('Delete this draft load? This cannot be undone.')) return;
    this.errorMessage = '';
    this.deletingDraft = true;
    this.loadsService.deleteDraftLoad(id).subscribe({
      next: () => {
        this.deletingDraft = false;
        this.successMessage = 'Draft deleted.';
        this.closeManualModal();
        this.loadLoads();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.deletingDraft = false;
        this.errorMessage = err?.error?.error || 'Failed to delete draft.';
      }
    });
  }

  /** Delete load from table (only NEW or DRAFT). */
  deleteLoadFromTable(load: LoadListItem): void {
    if (!this.canDeleteLoad(load)) return;
    if (!confirm('Delete this load? This cannot be undone.')) return;
    this.errorMessage = '';
    this.loadsService.deleteDraftLoad(load.id).subscribe({
      next: () => {
        this.successMessage = 'Load deleted.';
        this.loadLoads();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to delete load.';
      },
    });
  }

  isDraftLoad(load: LoadListItem): boolean {
    return (load.status || '').toString().toUpperCase() === 'DRAFT';
  }

  get isDraftEditStopInline(): boolean {
    return this.showEditStopModal && !!this.editingLoadDetail && this.isDraftLoad(this.editingLoadDetail);
  }

  /** True if load can be deleted (NEW or DRAFT only). */
  canDeleteLoad(load: LoadListItem): boolean {
    const s = (load.status || '').toString().toUpperCase();
    return s === 'DRAFT' || s === 'NEW';
  }

  // ─── FN-768: Bulk selection + actions ─────────────────────────────────────

  /** Number of loads currently selected. Used by the toolbar. */
  get selectedCount(): number { return this.selectedIds.size; }

  /** True when every load on the current page is selected. */
  get allVisibleSelected(): boolean {
    const rows = this.filteredLoads;
    return rows.length > 0 && rows.every((l) => this.selectedIds.has(l.id));
  }

  /** True when some — but not all — visible rows are selected (for the header checkbox). */
  get someVisibleSelected(): boolean {
    const rows = this.filteredLoads;
    const selected = rows.filter((l) => this.selectedIds.has(l.id)).length;
    return selected > 0 && selected < rows.length;
  }

  isSelected(load: LoadListItem): boolean { return this.selectedIds.has(load.id); }

  toggleRowSelect(load: LoadListItem, event?: Event): void {
    if (event) { event.stopPropagation(); }
    if (this.selectedIds.has(load.id)) {
      this.selectedIds.delete(load.id);
    } else {
      this.selectedIds.add(load.id);
    }
  }

  /** Select or clear every load on the currently visible page. */
  toggleSelectAll(): void {
    const rows = this.filteredLoads;
    if (this.allVisibleSelected) {
      rows.forEach((l) => this.selectedIds.delete(l.id));
    } else {
      rows.forEach((l) => this.selectedIds.add(l.id));
    }
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.bulkStatusToApply = '';
    this.bulkDriverToApply = '';
    this.bulkTruckToApply = '';
  }

  /** The subset of selected loads that are still present in the list cache. */
  get selectedLoads(): LoadListItem[] {
    return this.loads.filter((l) => this.selectedIds.has(l.id));
  }

  /** The subset of selected loads that are currently DRAFT. */
  get selectedDraftIds(): string[] {
    return this.selectedLoads.filter((l) => this.isDraftLoad(l)).map((l) => l.id);
  }

  applyBulkStatus(): void {
    const status = (this.bulkStatusToApply || '').trim();
    if (!status || !this.selectedCount || this.bulkActionInFlight) { return; }
    this._bulkUpdate({ status }, `${this.selectedCount} load(s) status set to ${status}.`);
  }

  applyBulkDriver(): void {
    const driverId = (this.bulkDriverToApply || '').trim();
    if (!driverId || !this.selectedCount || this.bulkActionInFlight) { return; }
    const name = this.drivers.find((d) => d.id === driverId)?.name || 'driver';
    this._bulkUpdate({ driverId }, `Assigned ${name} to ${this.selectedCount} load(s).`);
  }

  applyBulkTruck(): void {
    const truckId = (this.bulkTruckToApply || '').trim();
    if (!truckId || !this.selectedCount || this.bulkActionInFlight) { return; }
    const label = this.trucks.find((t) => t.id === truckId)?.label || 'truck';
    this._bulkUpdate({ truckId }, `Assigned ${label} to ${this.selectedCount} load(s).`);
  }

  bulkDeleteSelectedDrafts(): void {
    const ids = this.selectedDraftIds;
    if (!ids.length) {
      this.errorMessage = 'No DRAFT loads in the selection. Bulk delete only works on drafts.';
      setTimeout(() => { this.errorMessage = ''; }, 4000);
      return;
    }
    if (!confirm(`Delete ${ids.length} draft load(s)? This cannot be undone.`)) { return; }
    this.bulkActionInFlight = true;
    this.errorMessage = '';
    this.loadsService.bulkDeleteDrafts(ids).subscribe({
      next: (res) => {
        this.bulkActionInFlight = false;
        this.successMessage = `Deleted ${res.deleted} draft(s).`;
        this.clearSelection();
        this.loadLoads();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.bulkActionInFlight = false;
        this.errorMessage = err?.error?.error || 'Failed to delete drafts.';
      }
    });
  }

  bulkApproveSelectedDrafts(): void {
    const ids = this.selectedDraftIds;
    if (!ids.length) {
      this.errorMessage = 'No DRAFT loads in the selection.';
      setTimeout(() => { this.errorMessage = ''; }, 4000);
      return;
    }
    if (!confirm(`Approve ${ids.length} draft(s)? They will move to NEW status.`)) { return; }
    this._bulkUpdate({ status: 'NEW' }, `Approved ${ids.length} draft(s).`, ids);
  }

  /** Shared bulk-update pipeline: POST to backend, refresh list, clear selection. */
  private _bulkUpdate(
    changes: { status?: string; billingStatus?: string; driverId?: string | null; truckId?: string | null },
    successMessage: string,
    idsOverride?: string[]
  ): void {
    const ids = idsOverride || Array.from(this.selectedIds);
    if (!ids.length) { return; }
    this.bulkActionInFlight = true;
    this.errorMessage = '';
    this.loadsService.bulkUpdate(ids, changes).subscribe({
      next: () => {
        this.bulkActionInFlight = false;
        this.successMessage = successMessage;
        this.clearSelection();
        this.loadLoads();
        setTimeout(() => { this.successMessage = ''; }, 3000);
      },
      error: (err) => {
        this.bulkActionInFlight = false;
        this.errorMessage = err?.error?.error || 'Bulk update failed.';
      }
    });
  }

  /**
   * Export the selected loads to a CSV file. Uses the already-loaded row data
   * — no round-trip to the server — so exported columns match what the user
   * sees in the table.
   */
  exportSelectedToCsv(): void {
    const rows = this.selectedLoads;
    if (!rows.length) { return; }
    const header = [
      'Load #', 'Status', 'Billing', 'Driver', 'Broker', 'PO #',
      'Pickup City', 'Pickup State', 'Delivery City', 'Delivery State',
      'Rate', 'Completed Date'
    ];
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const l of rows) {
      const anyL = l as any;
      lines.push([
        esc(l.load_number),
        esc(l.status),
        esc(l.billing_status),
        esc(anyL.driver_name || ''),
        esc(anyL.broker_name || anyL.broker_display_name || ''),
        esc(anyL.po_number || ''),
        esc(anyL.pickup_city || ''),
        esc(anyL.pickup_state || ''),
        esc(anyL.delivery_city || ''),
        esc(anyL.delivery_state || ''),
        esc(l.rate != null ? l.rate : ''),
        esc(anyL.completed_date || ''),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `loads-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  getBulkFileNames(): string {
    return (this.bulkPdfFiles || []).map((f) => f.name).join(', ');
  }

  closeManualModal(): void {
    this.showManualModal = false;
    this.showUploadModal = false;
    this.editingLoadId = null;
    this.editingLoadDetail = null;
  }

  openRouteModal(): void {
    this.destroyRouteMap();
    this.showRouteModal = true;
    this.routeMapError = '';
    this.routeMapLoading = true;
    this.routeWaypoints = [];
    this.routeGeometry = null;
    const allStops = this.sortedStops || [];
    if (allStops.length < 2) {
      this.routeMapLoading = false;
      this.routeMapError = 'Add at least two stops to view the route.';
      return;
    }
    const stopsWithZip = allStops.filter((stop) => (stop.zip || '').toString().trim());
    if (stopsWithZip.length < 2) {
      this.routeMapLoading = false;
      this.routeMapError = 'Add zip codes to at least pickup and delivery to show the route on the map.';
      return;
    }
    const zipLookups = stopsWithZip.map((stop) => {
      const zip = (stop.zip || '').toString().trim();
      return this.loadsService.lookupZip(zip).pipe(
        map((res) => {
          const d = res?.data;
          if (d?.lat != null && d?.lon != null) return { lat: d.lat, lon: d.lon };
          return null;
        }),
        catchError(() => of(null))
      );
    });
    forkJoin(zipLookups).pipe(
      switchMap((waypoints) => {
        const validWaypoints = (waypoints.filter((w) => !!w) as { lat: number; lon: number }[]);
        if (validWaypoints.length < 2) {
          this.routeMapError = 'Could not resolve enough locations to draw the route.';
          this.routeMapLoading = false;
          return of(null);
        }
        this.routeWaypoints = validWaypoints;
        return this.loadsService.getRouteGeometry(this.routeWaypoints).pipe(
          map((geom) => {
            this.routeGeometry = geom;
            this.routeMapLoading = false;
            setTimeout(() => this.initRouteMap(), 350);
            return null;
          }),
          catchError(() => {
            this.routeMapLoading = false;
            this.routeGeometry = null;
            setTimeout(() => this.initRouteMap(), 350);
            return of(null);
          })
        );
      }),
      catchError(() => {
        this.routeMapLoading = false;
        this.routeMapError = 'Could not load route.';
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe();
  }

  closeRouteModal(): void {
    this.showRouteModal = false;
    this.destroyRouteMap();
  }

  setRouteMapLayer(layer: 'map' | 'satellite'): void {
    this.routeMapLayer = layer;
    if (!this.routeMap || !this.routeTileLayers) return;
    if (layer === 'map') {
      this.routeMap.removeLayer(this.routeTileLayers.satellite);
      this.routeMap.addLayer(this.routeTileLayers.map);
    } else {
      this.routeMap.removeLayer(this.routeTileLayers.map);
      this.routeMap.addLayer(this.routeTileLayers.satellite);
    }
  }

  private destroyRouteMap(): void {
    if (this.routeMap) {
      this.routeMap.remove();
      this.routeMap = null;
    }
    this.routeTileLayers = null;
  }

  private initRouteMap(): void {
    const container = document.getElementById('route-map-container');
    if (!container || container.children.length > 0) return;
    const waypoints = this.routeWaypoints;
    if (waypoints.length === 0) return;

    // Force container size so Leaflet gets correct dimensions (modal may not have laid out yet)
    container.style.height = '360px';
    container.style.width = '100%';
    container.style.minHeight = '360px';

    const map = L.map(container, { center: [waypoints[0].lat, waypoints[0].lon], zoom: 6 });
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri'
    });
    this.routeTileLayers = { map: osm, satellite };
    if (this.routeMapLayer === 'satellite') {
      satellite.addTo(map);
    } else {
      osm.addTo(map);
    }

    if (this.routeGeometry?.coordinates?.length) {
      const latLngs: L.LatLngExpression[] = this.routeGeometry.coordinates.map(([lon, lat]) => [lat, lon]);
      L.polyline(latLngs, { color: '#22c55e', weight: 5, opacity: 0.9 }).addTo(map);
    }

    waypoints.forEach((wp, i) => {
      const isFirst = i === 0;
      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          className: 'route-marker',
          html: `<span class="route-marker-num ${isFirst ? 'route-marker-pickup' : 'route-marker-delivery'}">#${i + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(map);
    });

    const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lon]));
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });

    // Leaflet needs the container to have final size; modal may still be laying out
    setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    }, 100);
    setTimeout(() => {
      if (this.routeMap === map) {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
      }
    }, 400);

    this.routeMap = map;
  }

  openNewStopModal(): void {
    this.newStopError = '';
    this.newStopForm.reset({
      stopType: 'DELIVERY',
      orderAfterIndex: 0,
      stopDate: '',
      company: '',
      address1: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      notes: ''
    });
    this.showNewStopModal = true;
  }

  closeNewStopModal(): void {
    this.showNewStopModal = false;
    this.newStopError = '';
  }

  openEditStopModal(stop: LoadStop, index: number): void {
    this.editingStopIndex = index;
    this.editStopError = '';
    const type = (stop?.stop_type || 'PICKUP').toString().toUpperCase();
    let dateVal = stop?.stop_date ? this.normalizeDate(stop.stop_date) : '';
    if (!dateVal) {
      const load = this.editingLoadDetail;
      const formPickup = this.manualLoadForm.get('pickupDate')?.value;
      const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
      if (type === 'PICKUP') dateVal = this.normalizeDate(load?.pickup_date || formPickup);
      else if (type === 'DELIVERY') dateVal = this.normalizeDate(load?.delivery_date || formDelivery);
    }
    this.editStopForm.reset({
      stopType: type,
      orderAfterIndex: Math.max(0, index - 1),
      appointmentType: 'FCFS',
      stopDate: dateVal,
      apptTime: '',
      company: '',
      address1: stop?.address1 || '',
      city: stop?.city || '',
      state: stop?.state || '',
      zip: stop?.zip || '',
      phone: '',
      notes: (stop as any)?.address2 || ''
    });
    this.showEditStopModal = true;
  }

  closeEditStopModal(): void {
    this.showEditStopModal = false;
    this.editingStopIndex = null;
    this.editStopError = '';
  }

  /** When user switches Stop type radio in Edit Stop modal, switch to editing that stop (pickup or delivery). */
  onEditStopTypeChange(value: string): void {
    const type = value.toString().toUpperCase();
    const stops = this.sortedStops || [];
    let idx = -1;
    if (type === 'PICKUP') {
      idx = stops.findIndex((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    } else if (type === 'DELIVERY' || type === 'OTHER') {
      idx = stops.findIndex((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    }
    if (idx < 0) return;
    const stop = stops[idx];
    this.editingStopIndex = idx;
    let dateVal = stop?.stop_date ? this.normalizeDate(stop.stop_date) : '';
    if (!dateVal) {
      const load = this.editingLoadDetail;
      const formPickup = this.manualLoadForm.get('pickupDate')?.value;
      const formDelivery = this.manualLoadForm.get('deliveryDate')?.value;
      if (type === 'PICKUP') dateVal = this.normalizeDate(load?.pickup_date || formPickup);
      else dateVal = this.normalizeDate(load?.delivery_date || formDelivery);
    }
    this.editStopForm.patchValue({
      stopType: type,
      orderAfterIndex: Math.max(0, idx - 1),
      stopDate: dateVal,
      address1: stop?.address1 || '',
      city: stop?.city || '',
      state: stop?.state || '',
      zip: stop?.zip || '',
      notes: (stop as any)?.address2 || ''
    });
  }

  lookupZipForEditStop(): void {
    const zip = (this.editStopForm.get('zip')?.value || '').toString().trim();
    if (zip.length < 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        this.editStopForm.patchValue({
          city: res?.data?.city || '',
          state: res?.data?.state || ''
        });
      }
    });
  }

  saveEditStop(): void {
    this.editStopError = '';
    this.editStopForm.markAllAsTouched();
    if (this.editStopForm.invalid) {
      this.editStopError = 'Please fill required fields: Date, City, State.';
      return;
    }
    if (this.editingStopIndex == null || !this.editingLoadId || !this.editingLoadDetail) {
      this.editStopError = 'No stop selected.';
      return;
    }
    const v = this.editStopForm.getRawValue();
    const rawType = (v.stopType || 'PICKUP').toString().toUpperCase();
    const stopType = rawType === 'OTHER' ? 'DELIVERY' : (rawType as 'PICKUP' | 'DELIVERY');
    const updated: LoadStop & { stopDate?: string } = {
      ...this.sortedStops[this.editingStopIndex],
      stop_type: stopType,
      stop_date: v.stopDate || null,
      stopDate: v.stopDate || undefined,
      city: v.city || null,
      state: v.state || null,
      zip: v.zip || null,
      address1: v.address1 || null,
      address2: v.notes || null
    };
    const stops = this.sortedStops.map((s, i) => ({
      ...s,
      sequence: i + 1,
      stop_date: s.stop_date ?? (s as any).stopDate ?? null
    }));
    const updatedWithDate = {
      ...updated,
      sequence: this.editingStopIndex + 1,
      stop_date: updated.stop_date ?? (updated as any).stopDate ?? null
    };
    stops[this.editingStopIndex] = updatedWithDate;
    const payload = this.buildLoadPayloadFromDetail();
    payload.stops = stops;
    this.savingEditStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingEditStop = false;
        this.closeEditStopModal();
      },
      error: () => {
        this.savingEditStop = false;
        this.editStopError = 'Failed to update stop.';
      }
    });
  }

  removeEditStop(): void {
    if (this.editingStopIndex == null || !this.editingLoadId || !this.editingLoadDetail) return;
    const stops = this.sortedStops.filter((_, i) => i !== this.editingStopIndex);
    const hasPickup = stops.some((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    const hasDelivery = stops.some((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    if (!hasPickup || !hasDelivery) {
      this.editStopError = 'Load must have at least one pickup and one delivery stop.';
      return;
    }
    const reordered = stops.map((s, i) => ({ ...s, sequence: i + 1 }));
    const payload = this.buildLoadPayloadFromDetail();
    payload.stops = reordered;
    this.savingEditStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingEditStop = false;
        this.closeEditStopModal();
      },
      error: () => {
        this.savingEditStop = false;
        this.editStopError = 'Failed to remove stop.';
      }
    });
  }

  private buildLoadPayloadFromDetail(): any {
    const d = this.editingLoadDetail!;
    return {
      status: d.status,
      billingStatus: d.billing_status,
      dispatcherUserId: this.dispatcherUserId,
      driverId: d.driver_id || null,
      truckId: d.truck_id || null,
      trailerId: d.trailer_id || null,
      brokerId: d.broker_id || null,
      brokerName: d.broker_name || null,
      poNumber: d.po_number || null,
      rate: d.rate ?? 0,
      notes: d.notes || null,
      stops: (d.stops || []).map((s, i) => ({ ...s, sequence: i + 1 }))
    };
  }

  private syncManualFormFromStops(): void {
    const stops = this.sortedStops || [];
    const pickup = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    const delivery = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    if (pickup) {
      const patch: any = {};
      if (pickup.stop_date) patch.pickupDate = this.normalizeDate(pickup.stop_date);
      if (pickup.city != null && pickup.city !== '') patch.pickupCity = pickup.city;
      if (pickup.state != null && pickup.state !== '') patch.pickupState = pickup.state;
      if (pickup.zip != null && pickup.zip !== '') patch.pickupZip = pickup.zip;
      if (Object.keys(patch).length) this.manualLoadForm.patchValue(patch);
    }
    if (delivery) {
      const patch: any = {};
      if (delivery.stop_date) patch.deliveryDate = this.normalizeDate(delivery.stop_date);
      if (delivery.city != null && delivery.city !== '') patch.deliveryCity = delivery.city;
      if (delivery.state != null && delivery.state !== '') patch.deliveryState = delivery.state;
      if (delivery.zip != null && delivery.zip !== '') patch.deliveryZip = delivery.zip;
      if (Object.keys(patch).length) this.manualLoadForm.patchValue(patch);
    }
  }

  saveNewStop(): void {
    this.newStopError = '';
    this.newStopForm.markAllAsTouched();
    if (this.newStopForm.invalid) {
      this.newStopError = 'Please fill required fields: Date, City, State.';
      return;
    }
    if (!this.editingLoadId || !this.editingLoadDetail) {
      this.newStopError = 'No load selected.';
      return;
    }
    const v = this.newStopForm.getRawValue();
    const orderAfter = Math.min(Number(v.orderAfterIndex) || 0, Math.max(0, this.sortedStops.length - 1));
    const newStop: LoadStop & { stopDate?: string } = {
      stop_type: v.stopType as 'PICKUP' | 'DELIVERY',
      stop_date: v.stopDate || null,
      stopDate: v.stopDate || undefined,
      city: v.city || null,
      state: v.state || null,
      zip: v.zip || null,
      address1: v.address1 || null,
      address2: v.notes || null,
      sequence: orderAfter + 2
    };
    const existing = this.sortedStops.map((s, i) => ({ ...s, sequence: i + 1 }));
    const inserted = [...existing.slice(0, orderAfter + 1), newStop, ...existing.slice(orderAfter + 1)];
    for (let i = 0; i < inserted.length; i++) {
      inserted[i].sequence = i + 1;
    }
    const payload = {
      status: this.editingLoadDetail.status,
      billingStatus: this.editingLoadDetail.billing_status,
      dispatcherUserId: this.dispatcherUserId,
      driverId: this.editingLoadDetail.driver_id || null,
      truckId: this.editingLoadDetail.truck_id || null,
      trailerId: this.editingLoadDetail.trailer_id || null,
      brokerId: this.editingLoadDetail.broker_id || null,
      brokerName: this.editingLoadDetail.broker_name || null,
      poNumber: this.editingLoadDetail.po_number || null,
      rate: this.editingLoadDetail.rate ?? 0,
      notes: this.editingLoadDetail.notes || null,
      stops: inserted
    };
    this.savingNewStop = true;
    this.loadsService.updateLoad(this.editingLoadId, payload).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
          this.syncManualFormFromStops();
        }
        this.savingNewStop = false;
        this.closeNewStopModal();
      },
      error: () => {
        this.savingNewStop = false;
        this.newStopError = 'Failed to add stop.';
      }
    });
  }

  recalculateDistance(): void {
    if (!this.editingLoadId) return;
    this.loadsService.getLoad(this.editingLoadId).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (detail) {
          this.editingLoadDetail = detail;
          this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        }
      },
      error: () => {
        this.errorMessage = 'Failed to refresh load.';
      }
    });
  }

  dispatchInfoToDriver(): void {
    // To be implemented later
  }

  closeAutoModal(): void {
    this.showAutoModal = false;
  }

  openDetails(load: LoadListItem): void {
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        this.selectedLoad = res?.data || null;
        this.showDetailsModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details.';
      }
    });
  }

  closeDetails(): void {
    this.showDetailsModal = false;
    this.selectedLoad = null;
  }

  openEdit(load: LoadListItem, attachmentTabFirst?: boolean): void {
    this.errorMessage = '';
    this.creatingLoad = false;
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.errorMessage = 'Failed to load details for edit.';
          return;
        }
        this.editingLoadId = detail.id;
        this.editingLoadDetail = detail;
        this.sortedStops = (detail.stops || []).slice().sort((a, b) => {
          const aSeq = a.sequence ?? 0;
          const bSeq = b.sequence ?? 0;
          return aSeq - bSeq;
        });
        this.attachmentTab = attachmentTabFirst ? 'documents' : 'documents';
        this.populateFormFromDetail(detail);
        this.loadBrokers();
        this.showManualModal = true;
      },
      error: () => {
        this.errorMessage = 'Failed to load details for edit.';
      }
    });
  }

  /** Open load edit and then show route map (based on stop zips). */
  openEditAndShowMap(load: LoadListItem): void {
    this.errorMessage = '';
    this.creatingLoad = false;
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.errorMessage = 'Failed to load details for map.';
          return;
        }
        this.editingLoadId = detail.id;
        this.editingLoadDetail = detail;
        this.sortedStops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        this.attachmentTab = 'documents';
        this.populateFormFromDetail(detail);
        this.loadBrokers();
        this.showManualModal = true;
        setTimeout(() => this.openRouteModal(), 100);
      },
      error: () => {
        this.errorMessage = 'Failed to load details for map.';
      }
    });
  }

  /** Open load for edit with documents tab focused (e.g. from attachment chips). */
  openEditForAttachments(load: LoadListItem): void {
    this.openEdit(load, true);
  }

  /** Copy load: create a new draft with same details, then open for edit. */
  copyLoad(load: LoadListItem): void {
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.errorMessage = 'Failed to load load details for copy.';
          return;
        }
        const payload = this.buildCreatePayloadFromDetail(detail);
        this.loadsService.createLoad(payload).subscribe({
          next: (created) => {
            const newId = created?.data?.id;
            if (newId) {
              this.loadLoads();
              this.successMessage = 'Load copied. Opening for edit.';
              setTimeout(() => { this.successMessage = ''; }, 3000);
              this.loadsService.getLoad(newId).subscribe({
                next: (r) => {
                  const newDetail = r?.data;
                  if (newDetail) this.openEdit({ ...newDetail, id: newId } as LoadListItem);
                }
              });
            }
          },
          error: (err) => {
            this.errorMessage = err?.error?.error || 'Failed to copy load.';
          }
        });
      },
      error: () => {
        this.errorMessage = 'Failed to load details for copy.';
      }
    });
  }

  private buildCreatePayloadFromDetail(detail: LoadDetail): any {
    const stops = (detail.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const pickup = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP');
    const delivery = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY');
    const pickupDate = pickup?.stop_date ?? (detail as any).pickup_date;
    const deliveryDate = delivery?.stop_date ?? (detail as any).delivery_date;
    return {
      loadNumber: (detail.load_number || '').toString().trim() ? `Copy of ${(detail.load_number || '').toString().slice(0, 40)}` : undefined,
      status: 'DRAFT',
      billingStatus: detail.billing_status || 'PENDING',
      brokerId: detail.broker_id || undefined,
      brokerName: detail.broker_name || undefined,
      poNumber: detail.po_number || undefined,
      rate: detail.rate ?? 0,
      notes: detail.notes ?? undefined,
      driverId: undefined,
      truckId: undefined,
      trailerId: undefined,
      pickupDate: pickupDate ? String(pickupDate).slice(0, 10) : undefined,
      deliveryDate: deliveryDate ? String(deliveryDate).slice(0, 10) : undefined,
      stops: stops.map((s, i) => ({
        stopType: s.stop_type,
        sequence: i + 1,
        date: s.stop_date ? String(s.stop_date).slice(0, 10) : undefined,
        city: s.city,
        state: s.state,
        zip: s.zip,
        address1: s.address1
      }))
    };
  }

  /**
   * FN-756: Clone an existing load — backend returns a draft-ready payload
   * (dates cleared, status=DRAFT, PO cleared, new load_number). We pre-fill the
   * inline new-load form; nothing persists until the user saves.
   */
  cloneLoad(load: LoadListItem): void {
    if (!load?.id) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loadsService.cloneLoad(load.id).subscribe({
      next: (res) => {
        const draft = res?.data;
        if (!draft) {
          this.errorMessage = 'Failed to clone load.';
          return;
        }
        this.applyDraftToManualForm(draft);
        this.successMessage = 'Cloned load — set the pickup/delivery dates and save.';
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to clone load.';
      }
    });
  }

  /**
   * FN-756: Create a Return Load — backend returns a draft-ready payload with
   * stops reversed, rate cleared, dates cleared, broker/driver/equipment kept,
   * status=DRAFT. Nothing persists until the user saves.
   */
  createReturnLoad(load: LoadListItem): void {
    if (!load?.id) return;
    this.errorMessage = '';
    this.successMessage = '';
    this.loadsService.returnLoad(load.id).subscribe({
      next: (res) => {
        const draft = res?.data;
        if (!draft) {
          this.errorMessage = 'Failed to create return load.';
          return;
        }
        this.applyDraftToManualForm(draft);
        this.successMessage = 'Return load ready — review stops, set dates and rate, then save.';
        setTimeout(() => { this.successMessage = ''; }, 5000);
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to create return load.';
      }
    });
  }

  /**
   * FN-756: Seed the inline new-load form from a clone/return-load draft payload.
   * The backend is authoritative for what carries over (dates, rate, PO, etc.);
   * this function just patches whatever the server returned.
   */
  private applyDraftToManualForm(draft: LoadDetail): void {
    this.openManualEntry();

    const stops = (draft.stops || []).slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const pickup = stops.find((s) => (s.stop_type || '').toString().toUpperCase() === 'PICKUP') || stops[0];
    const delivery = [...stops].reverse().find((s) => (s.stop_type || '').toString().toUpperCase() === 'DELIVERY') || stops[stops.length - 1];

    this.manualLoadForm.patchValue({
      status: draft.status || 'DRAFT',
      billingStatus: draft.billing_status || 'PENDING',
      brokerId: draft.broker_id || '',
      brokerName: draft.broker_display_name || draft.broker_name || '',
      driverId: draft.driver_id || '',
      truckId: draft.truck_id || '',
      trailerId: draft.trailer_id || '',
      poNumber: draft.po_number || '',
      rate: draft.rate != null ? draft.rate : '',
      notes: draft.notes || '',
      pickupDate: draft.pickup_date ? String(draft.pickup_date).slice(0, 10) : '',
      pickupCity: pickup?.city || '',
      pickupState: pickup?.state || '',
      pickupZip: pickup?.zip || '',
      deliveryDate: draft.delivery_date ? String(draft.delivery_date).slice(0, 10) : '',
      deliveryCity: delivery?.city || '',
      deliveryState: delivery?.state || '',
      deliveryZip: delivery?.zip || ''
    });

    // Preserve intermediate stops when there are more than two
    if (stops.length > 2) {
      this.sortedStops = stops.map((s, i) => ({
        stop_type: (s.stop_type as 'PICKUP' | 'DELIVERY') || (i === 0 ? 'PICKUP' : 'DELIVERY'),
        stop_date: s.stop_date ?? null,
        city: s.city || null,
        state: s.state || null,
        zip: s.zip || null,
        address1: s.address1 || null,
        sequence: s.sequence ?? i + 1
      }));
    }
  }

  private populateFormFromDetail(detail: LoadDetail): void {
    const normalizeDate = (value: unknown): string => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value as any);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    };
    const pickup = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'PICKUP');
    const delivery = (detail.stops || []).find((s) => (s.stop_type || '').toUpperCase() === 'DELIVERY');

    // Prefer stop dates; if missing, fall back to top-level pickup/delivery dates
    const pickupDate = pickup?.stop_date
      ? normalizeDate(pickup.stop_date as any)
      : normalizeDate((detail as any).pickup_date);
    const deliveryDate = delivery?.stop_date
      ? normalizeDate(delivery.stop_date as any)
      : normalizeDate((detail as any).delivery_date);
    this.manualLoadForm.reset({
      status: detail.status,
      billingStatus: detail.billing_status,
      dispatcher: this.dispatcherName || '',
      pickupDate,
      pickupCity: pickup?.city || '',
      pickupState: pickup?.state || '',
      pickupZip: pickup?.zip || '',
      deliveryDate,
      deliveryCity: delivery?.city || '',
      deliveryState: delivery?.state || '',
      deliveryZip: delivery?.zip || '',
      driverId: detail.driver_id || '',
      // FN-545: fall back to driver's assigned truck/trailer if load fields are blank
      truckId: detail.truck_id || this.drivers.find(d => d.id === detail.driver_id)?.truckId || '',
      trailerId: detail.trailer_id || this.drivers.find(d => d.id === detail.driver_id)?.trailerId || '',
      brokerId: detail.broker_id || '',
      brokerName: detail.broker_name || '',
      poNumber: detail.po_number || '',
      rate: detail.rate ?? '',
      notes: detail.notes ?? ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
    // FN-545: sync inline search labels for driver/truck/trailer
    const driverObj = this.drivers.find(d => d.id === (detail.driver_id || ''));
    this.driverSearch = driverObj ? driverObj.name : '';
    const resolvedTruckId = detail.truck_id || driverObj?.truckId || '';
    const truckObj = this.trucks.find(t => t.id === resolvedTruckId);
    this.truckSearch = truckObj ? truckObj.label : '';
    const resolvedTrailerId = detail.trailer_id || driverObj?.trailerId || '';
    const trailerObj = this.trailers.find(t => t.id === resolvedTrailerId);
    this.trailerSearch = trailerObj ? trailerObj.label : '';
  }

  resetManualForm(): void {
    this.manualLoadForm.reset({
      status: 'NEW',
      billingStatus: 'PENDING',
      dispatcher: this.dispatcherName || '',
      pickupDate: '',
      pickupCity: '',
      pickupState: '',
      pickupZip: '',
      deliveryDate: '',
      deliveryCity: '',
      deliveryState: '',
      deliveryZip: '',
      driverId: '',
      truckId: '',
      trailerId: '',
      brokerId: '',
      brokerName: '',
      poNumber: '',
      rate: '',
      notes: ''
    });
    this.pickupCityEdited = false;
    this.pickupStateEdited = false;
    this.deliveryCityEdited = false;
    this.deliveryStateEdited = false;
    this.sortedStops = [];
  }

  /** Apply extracted AI values into the manual load form for review (same scenarios as bulk: multi-stop, PO, etc.). */
  private applyExtractionToForm(extraction: LoadAiEndpointExtraction): void {
    this.editingLoadId = null;
    this.editingLoadDetail = null;
    this.resetManualForm();

    const pickup = extraction.pickup || ({} as any);
    const delivery = extraction.delivery || ({} as any);

    this.manualLoadForm.patchValue({
      brokerName: extraction.brokerName || '',
      poNumber: extraction.poNumber || (extraction.loadId || extraction.orderId || extraction.proNumber || '').toString() || '',
      rate: extraction.rate != null ? extraction.rate : '',
      pickupDate: pickup.date || '',
      pickupCity: pickup.city || '',
      pickupState: pickup.state || '',
      pickupZip: pickup.zip || '',
      deliveryDate: delivery.date || '',
      deliveryCity: delivery.city || '',
      deliveryState: delivery.state || '',
      deliveryZip: delivery.zip || ''
    });

    // Apply multi-stop when present (same as bulk upload)
    const rawStops = extraction.stops && Array.isArray(extraction.stops) ? extraction.stops : [];
    if (rawStops.length > 0) {
      this.sortedStops = rawStops
        .map((s, i) => ({
          stop_type: (s.type || (i === 0 ? 'PICKUP' : 'DELIVERY')) as 'PICKUP' | 'DELIVERY',
          sequence: s.sequence ?? i + 1,
          stop_date: s.date || null,
          city: s.city || null,
          state: s.state || null,
          zip: s.zip || null,
          address1: s.address1 || null
        }))
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    }
  }

  markPickupCityEdited(): void {
    this.pickupCityEdited = true;
  }

  markPickupStateEdited(): void {
    this.pickupStateEdited = true;
  }

  markDeliveryCityEdited(): void {
    this.deliveryCityEdited = true;
  }

  markDeliveryStateEdited(): void {
    this.deliveryStateEdited = true;
  }

  lookupPickupZip(): void {
    const zip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.pickupCityEdited) {
          this.manualLoadForm.patchValue({ pickupCity: res?.data?.city || '' });
        }
        if (!this.pickupStateEdited) {
          this.manualLoadForm.patchValue({ pickupState: res?.data?.state || '' });
        }
      }
    });
  }

  lookupDeliveryZip(): void {
    const zip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    if (zip.length !== 5) return;
    this.loadsService.lookupZip(zip).subscribe({
      next: (res) => {
        if (!this.deliveryCityEdited) {
          this.manualLoadForm.patchValue({ deliveryCity: res?.data?.city || '' });
        }
        if (!this.deliveryStateEdited) {
          this.manualLoadForm.patchValue({ deliveryState: res?.data?.state || '' });
        }
      }
    });
  }

  setAttachmentFiles(files: FileList | null): void {
    this.selectedAttachmentFiles = files;
  }

  saveAttachment(): void {
    this.attachmentError = '';
    if (!this.selectedAttachmentFiles || this.selectedAttachmentFiles.length === 0) {
      this.attachmentError = 'Please select a file first.';
      return;
    }

    if (this.editingLoadId) {
      const loadId = this.editingLoadId;
      const notes = this.uploadAttachmentNotes || '';
      const uploads = Array.from(this.selectedAttachmentFiles).map((file) =>
        this.loadsService.uploadAttachment(loadId, file, this.uploadAttachmentType, notes)
      );
      let completed = 0;
      uploads.forEach((obs) => {
        obs.subscribe({
          next: () => {
            completed += 1;
            if (completed === uploads.length) {
              this.refreshEditingAttachments(loadId);
            }
          },
          error: () => {
            this.attachmentError = 'Failed to upload one or more attachments.';
          }
        });
      });
    } else {
      Array.from(this.selectedAttachmentFiles).forEach((file) => {
        this.pendingAttachments.push({
          file,
          type: this.uploadAttachmentType,
          notes: this.uploadAttachmentNotes || undefined
        });
      });
    }

    this.uploadAttachmentNotes = '';
    this.selectedAttachmentFiles = null;
    this.showUploadModal = false;
  }

  removeAttachment(index: number): void {
    this.pendingAttachments.splice(index, 1);
  }

  handleDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.selectedAttachmentFiles = event.dataTransfer.files;
      this.saveAttachment();
    }
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  handleReplaceDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      this.setReplaceAttachmentFile(event.dataTransfer.files);
    }
  }

  // Placeholder hooks for upcoming services/documents logic
  onNewLumper(): void {
    // TODO: implement lumper service creation
    // eslint-disable-next-line no-console
    console.log('New lumper clicked');
  }

  onNewDetention(): void {
    // TODO: implement detention service creation
    // eslint-disable-next-line no-console
    console.log('New detention clicked');
  }

  onOtherAdditions(): void {
    // TODO: implement other additions/deductions creation
    // eslint-disable-next-line no-console
    console.log('Other additions/deductions clicked');
  }

  hasMultipleDocuments(): boolean {
    if (this.editingLoadId) {
      return (this.editingLoadDetail?.attachments?.length ?? 0) > 1;
    }
    return this.pendingAttachments.length > 1;
  }

  mergeDocuments(): void {
    // TODO: implement merge-to-single-PDF behavior
    // eslint-disable-next-line no-console
    console.log('Merge documents clicked');
  }

  editAttachment(att: LoadAttachment): void {
    this.editingAttachment = att;
    this.replaceAttachmentType = att.type;
    this.replaceAttachmentNotes = att.notes ?? '';
    this.replaceAttachmentFile = null;
    this.attachmentError = '';
    this.showReplaceModal = true;
  }

  closeReplaceModal(): void {
    this.editingAttachment = null;
    this.showReplaceModal = false;
    this.replaceAttachmentFile = null;
    this.attachmentError = '';
  }

  setReplaceAttachmentFile(files: FileList | null): void {
    this.replaceAttachmentFile = files?.length ? files[0] : null;
  }

  saveReplaceAttachment(): void {
    if (!this.editingLoadId || !this.editingAttachment) return;
    this.replacingAttachment = true;
    this.attachmentError = '';
    this.loadsService
      .updateAttachment(
        this.editingLoadId,
        this.editingAttachment.id,
        this.replaceAttachmentFile ?? undefined,
        this.replaceAttachmentType,
        this.replaceAttachmentNotes
      )
      .subscribe({
        next: () => {
          this.refreshEditingAttachments(this.editingLoadId!);
          this.closeReplaceModal();
          this.replacingAttachment = false;
        },
        error: (err) => {
          this.attachmentError = err?.error?.error || 'Failed to update document';
          this.replacingAttachment = false;
        }
      });
  }

  deleteAttachment(att: LoadAttachment): void {
    if (!this.editingLoadId) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;
    this.attachmentError = '';
    this.loadsService.deleteAttachment(this.editingLoadId, att.id).subscribe({
      next: () => this.refreshEditingAttachments(this.editingLoadId!),
      error: (err) => {
        this.attachmentError = err?.error?.error || 'Failed to delete document';
      }
    });
  }

  private refreshEditingAttachments(loadId: string): void {
    this.loadsService.getLoad(loadId).subscribe({
      next: (res) => {
        this.editingLoadDetail = res?.data || this.editingLoadDetail;
      }
    });
  }

  validatePickupDelivery(): string[] {
    const errors: string[] = [];
    const pickupZip = (this.manualLoadForm.value.pickupZip || '').toString().trim();
    const pickupCity = (this.manualLoadForm.value.pickupCity || '').toString().trim();
    const pickupState = (this.manualLoadForm.value.pickupState || '').toString().trim();
    const deliveryZip = (this.manualLoadForm.value.deliveryZip || '').toString().trim();
    const deliveryCity = (this.manualLoadForm.value.deliveryCity || '').toString().trim();
    const deliveryState = (this.manualLoadForm.value.deliveryState || '').toString().trim();

    if (!(pickupZip || (pickupCity && pickupState))) {
      errors.push('Pickup ZIP or Pickup City/State is required.');
    }
    if (!(deliveryZip || (deliveryCity && deliveryState))) {
      errors.push('Delivery ZIP or Delivery City/State is required.');
    }
    return errors;
  }

  createLoad(): void {
    this.successMessage = '';
    this.errorMessage = '';
    const isEdit = !!this.editingLoadId;

    this.manualLoadForm.markAllAsTouched();
    const invalidFields: string[] = [];
    const controls = this.manualLoadForm.controls;
    if (controls['status']?.invalid) invalidFields.push('Status');
    if (controls['billingStatus']?.invalid) invalidFields.push('Billing Status');
    if (controls['rate']?.invalid) invalidFields.push('Rate');
    if (!isEdit) {
      if (controls['pickupDate']?.invalid) invalidFields.push('Pickup Date');
      if (controls['deliveryDate']?.invalid) invalidFields.push('Delivery Date');
    }
    if (this.manualLoadForm.invalid && invalidFields.length > 0) {
      this.errorMessage =
        invalidFields.length > 0
          ? `Please fix the following fields before submitting: ${invalidFields.join(', ')}.`
          : 'Please fix the validation errors before submitting.';
      return;
    }

    if (!isEdit) {
      const validationErrors = this.validatePickupDelivery();
      if (validationErrors.length > 0) {
        this.errorMessage = validationErrors.join(' ');
        return;
      }
    }

    const formValue = this.manualLoadForm.getRawValue();
    const stops: LoadStop[] = isEdit && this.sortedStops?.length
      ? this.sortedStops.map((s, i) => ({ ...s, sequence: i + 1 }))
      : [
          {
            stop_type: 'PICKUP',
            stop_date: formValue.pickupDate,
            city: formValue.pickupCity,
            state: formValue.pickupState,
            zip: formValue.pickupZip,
            sequence: 1
          },
          {
            stop_type: 'DELIVERY',
            stop_date: formValue.deliveryDate,
            city: formValue.deliveryCity,
            state: formValue.deliveryState,
            zip: formValue.deliveryZip,
            sequence: 2
          }
        ];

    const payload = {
      status: formValue.status,
      billingStatus: formValue.billingStatus,
      dispatcherUserId: this.dispatcherUserId,
      driverId: formValue.driverId || null,
      truckId: formValue.truckId || null,
      trailerId: formValue.trailerId || null,
      brokerId: formValue.brokerId || null,
      brokerName: formValue.brokerName || null,
      poNumber: formValue.poNumber || null,
      rate: formValue.rate ? Number(formValue.rate) : 0,
      notes: formValue.notes || null,
      stops
    };

    this.creatingLoad = true;
    const request$ = isEdit
      ? this.loadsService.updateLoad(this.editingLoadId as string, payload)
      : this.loadsService.createLoad(payload);

    request$.subscribe({
      next: (res) => {
        const load = res?.data;
        if (!load?.id) {
          this.creatingLoad = false;
          this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
          return;
        }
        if (this.pendingAttachments.length === 0 || isEdit) {
          this.finishCreate(isEdit);
          return;
        }
        const uploads = this.pendingAttachments.map((item) =>
          this.loadsService.uploadAttachment(load.id, item.file, item.type, item.notes)
        );
        let uploaded = 0;
        uploads.forEach((obs) => {
          obs.subscribe({
            next: () => {
              uploaded += 1;
              if (uploaded === uploads.length) {
                this.finishCreate(isEdit);
              }
            },
            error: () => {
              this.errorMessage = 'Load created, but attachment upload failed.';
              this.finishCreate(isEdit);
            }
          });
        });
      },
      error: () => {
        this.creatingLoad = false;
        this.errorMessage = isEdit ? 'Failed to update load.' : 'Failed to create load.';
      }
    });
  }

  finishCreate(isEdit: boolean): void {
    this.creatingLoad = false;
    this.successMessage = isEdit ? 'Load updated successfully.' : 'Load created successfully.';
    this.editingLoadId = null;
    this.closeManualModal();
    this.showInlineNewLoad = false;
    this.loadLoads();
    setTimeout(() => {
      this.successMessage = '';
    }, 4000);
  }

  // ─── FN-821: empty-state + error-state helpers ─────────────────────────────

  /** Active smart-filter / header-filter / status-filter surface. */
  get hasActiveListFilters(): boolean {
    const f = this.filters;
    if (f.status || f.billingStatus || f.driverId || f.q || f.needsReview || f.source) return true;
    if (this.smartFilterKeys.length > 0) return true;
    const hf = this.headerFilters;
    return !!(hf.date || hf.driver || hf.broker || hf.po || hf.pickup || hf.delivery
      || hf.rate || hf.completed || hf.status || hf.billingStatus || hf.attachmentType);
  }

  /** Which empty-state variant the card should render right now. */
  get emptyStateMode(): EmptyStateMode {
    if (this.loadError) {
      return this.permissionDenied ? 'permission-denied' : 'api-error';
    }
    // Smart-filter returning zero gets the celebratory variant when the
    // chip's semantics are "bad things" (overdue, needs review) — otherwise
    // fall through to the regular filtered empty.
    if (this.smartFilterKeys.length > 0 && this.isCelebratorySmartFilter(this.smartFilterKeys[0])) {
      return 'smart-filter-celebrate';
    }
    if (this.hasActiveListFilters) return 'filtered';
    return 'no-loads';
  }

  /** Friendly label of the first active smart-filter chip, for celebrate mode copy. */
  get activeSmartFilterLabel(): string {
    if (!this.smartFilterKeys.length) return '';
    const key = this.smartFilterKeys[0];
    const labels: Record<string, string> = {
      overdue: 'overdue',
      needs_review: 'loads needing review',
      missing_pod: 'loads missing POD',
      unpaid: 'unpaid',
      upcoming: 'upcoming',
    };
    return labels[key as string] || (key as string).replace(/_/g, ' ');
  }

  /** Smart filters whose "0 matches" reads as good news rather than empty. */
  private isCelebratorySmartFilter(key: string): boolean {
    return key === 'overdue' || key === 'needs_review' || key === 'missing_pod';
  }

  /** Skeleton row column config derived from columnDefs + visibility + width map. */
  get skeletonColumns(): SkeletonColumn[] {
    return this.columnDefs.map((c) => ({
      key: c.key,
      width: this.columnWidthMap[c.key] || 'auto',
      visible: this.isColVisible(c.key),
    }));
  }

  /** Empty-state: "Clear filters" action — reuses the existing clearAllFilters. */
  onEmptyStateClearFilters(): void {
    this.clearAllFilters();
  }

  /** Empty-state: "Create your first load" — opens the standard wizard. */
  onEmptyStateCreateLoad(): void {
    this.openLoadWizard();
  }

  /** Empty-state: "Import from PDF" — trigger the hidden file picker. */
  onEmptyStateImportFromPdf(): void {
    this.emptyStateBulkInput?.nativeElement?.click();
  }

  /** Hidden file input change → route through the existing hero-bulk handler. */
  onEmptyStateBulkPdfsChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input?.files;
    if (!files || files.length === 0) return;
    this.onHeroBulkPdfs(Array.from(files));
    // Reset so the same file can be re-selected later.
    input.value = '';
  }

  /** Empty-state: "Try again" after an API failure. */
  onEmptyStateRetry(): void {
    this.loadLoads();
  }

  // ─── FN-821: filter-applied fade pulse ─────────────────────────────────────

  private triggerFilterPulse(): void {
    this.filterPulseActive = true;
    if (this.filterPulseTimer) {
      clearTimeout(this.filterPulseTimer);
    }
    // Matches the CSS animation duration (280ms) + small buffer.
    this.filterPulseTimer = setTimeout(() => {
      this.filterPulseActive = false;
      this.filterPulseTimer = null;
    }, 320);
  }

  // ─── FN-821: density mode ──────────────────────────────────────────────────

  /** Row height in px for both CSS vars and the cdk-virtual-scroll itemSize. */
  get rowHeightPx(): number {
    return this.densityOptions.find((o) => o.value === this.densityMode)?.heightPx ?? 52;
  }

  toggleDensityMenu(): void {
    this.densityMenuOpen = !this.densityMenuOpen;
    if (this.densityMenuOpen) {
      this.showColumnPicker = false;
      this.showSavedViewsMenu = false;
    }
  }

  setDensity(mode: DensityMode): void {
    if (this.densityMode === mode) {
      this.densityMenuOpen = false;
      return;
    }
    this.densityMode = mode;
    this.densityMenuOpen = false;
    this.userPreferences.patchLoadsDashboard({ density: mode }).subscribe();
  }

  // ─── FN-821: scroll-to-top button ──────────────────────────────────────────

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    const next = y > 300;
    if (next !== this.showScrollTop) {
      this.showScrollTop = next;
    }
  }

  scrollToTop(): void {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  rowClass(load: LoadListItem): string {
    const status = (load.status || '').toString().toUpperCase();
    const classes: string[] = [];
    if (status === 'DELIVERED') classes.push('row-delivered');
    if (status === 'CANCELLED') classes.push('row-cancelled');
    // FN-808: teal left-border highlight on the active drawer row.
    if (this.isDrawerActive(load)) classes.push('row-drawer-active');
    // FN-818: one-off glow when a new AI-extracted load lands in the list.
    if (this.newAiLoadIds.has(load.id)) classes.push('row-new-ai');
    return classes.join(' ');
  }

  // ─── FN-818: AI extraction helpers ─────────────────────────────────────────

  /** True when the load was created by an AI extraction pipeline (PDF or email). */
  isAiExtractedSource(load: LoadListItem): boolean {
    const src = (load.source || '').toLowerCase();
    return src === 'ai_extraction' || src === 'ai' || src === 'email';
  }

  /** Overall confidence as 0–100 pulled from ai_metadata (null when missing). */
  getOverallConfidence(load: LoadListItem): number | null {
    const raw = load.ai_metadata?.overall_confidence;
    if (raw == null || !Number.isFinite(raw)) return null;
    // Accept 0–1 floats from some extractors; normalise to percent.
    return raw <= 1 ? raw * 100 : raw;
  }

  /** Hover copy for the row sparkle. Matches FN-789 spec. */
  getSparkleTooltip(load: LoadListItem): string {
    const meta = load.ai_metadata;
    const when = meta?.extracted_at ? new Date(meta.extracted_at as string) : null;
    const whenStr = when && !isNaN(when.getTime()) ? when.toLocaleDateString() : null;
    const label = (meta?.source_label as string | undefined)
      || (load.source === 'email' ? 'forwarded email' : 'rate confirmation PDF');
    return whenStr
      ? `Auto-extracted from ${label} on ${whenStr}`
      : `Auto-extracted from ${label}`;
  }

  /** Whether to surface the confidence chip in the status column (DRAFT + confidence present). */
  shouldShowConfidenceBadge(load: LoadListItem): boolean {
    const status = (load.status || '').toUpperCase();
    if (status !== 'DRAFT' && status !== 'NEW') return false;
    return this.getOverallConfidence(load) != null;
  }

  /** Confidence chip click → open the drawer focused on low-confidence fields. */
  onConfidenceBadgeClick(load: LoadListItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.openLoadDrawer(load.id, true);
  }

  /** Row sparkle click → open the drawer on the AI-extracted load. */
  onRowSparkleClick(load: LoadListItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.openLoadDrawer(load.id);
  }

  /**
   * FN-818 — diff the incoming list against the last snapshot; any AI-sourced IDs
   * that weren't present before get flagged so the `<tr>` picks up a one-off glow
   * class via `rowClass`. We deliberately skip the very first response so users
   * don't see every existing AI load light up on page load.
   */
  private trackNewAiLoads(loads: LoadListItem[]): void {
    const currentIds = new Set(loads.map((l) => l.id));
    if (!this.seenFirstLoadsResponse) {
      this.seenFirstLoadsResponse = true;
      this.previousLoadIds = currentIds;
      return;
    }
    const freshAiIds = loads
      .filter((l) => this.isAiExtractedSource(l) && !this.previousLoadIds.has(l.id))
      .map((l) => l.id);
    if (freshAiIds.length) {
      freshAiIds.forEach((id) => this.newAiLoadIds.add(id));
      if (this.newAiGlowTimer) clearTimeout(this.newAiGlowTimer);
      // 3.2s ≈ glow CSS animation duration + small buffer.
      this.newAiGlowTimer = setTimeout(() => {
        this.newAiLoadIds.clear();
        this.newAiGlowTimer = null;
      }, 3200);
    }
    this.previousLoadIds = currentIds;
  }

  /** Build full URL for attachment download (backend serves /uploads). */
  getAttachmentUrl(att: { file_url?: string | null }): string {
    if (!att?.file_url) return '';
    if (att.file_url.startsWith('http://') || att.file_url.startsWith('https://')) {
      return att.file_url;
    }
    const base = environment.apiUrl.replace(/\/api\/?$/, '');
    return base + (att.file_url.startsWith('/') ? att.file_url : '/' + att.file_url);
  }

  /** Fetch load detail and open the first attachment matching the given type in a new tab. */
  downloadAttachmentByType(load: LoadListItem, type: string): void {
    this.loadsService.getLoad(load.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) return;
        const att = (detail.attachments || []).find(
          (a) => (a.type || '').toString().toUpperCase() === (type || '').toString().toUpperCase()
        );
        if (!att) return;
        const url = this.getAttachmentUrl(att);
        if (url) window.open(url, '_blank');
      }
    });
  }

  /** First rate confirmation PDF URL for draft review (side-by-side view). */
  get draftRateConPdfUrl(): string {
    const atts = this.editingLoadDetail?.attachments || [];
    const rateCon = atts.find((a) => (a.type || '').toString() === 'RATE_CONFIRMATION');
    return rateCon ? this.getAttachmentUrl(rateCon) : '';
  }

  /** Sanitized PDF URL for iframe in draft review. */
  get draftRateConPdfSafeUrl(): SafeResourceUrl {
    const url = this.draftRateConPdfUrl;
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : this.sanitizer.bypassSecurityTrustResourceUrl('about:blank');
  }

  // FN-854: Esc closes the inline Status/Billing dropdown. The menu is
  // portaled via CDK Overlay, so keydown does not bubble through the
  // component host — listen at document level, act only if a menu is open.
  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.statusMenuLoadId || this.billingMenuLoadId) {
      this.statusMenuLoadId = null;
      this.billingMenuLoadId = null;
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showNewLoadMenu = false;
    this.actionsOpenLoadId = null;
    this.brokerDropdownOpen = false;
    this.driverDropdownOpen = false;
    this.truckDropdownOpen = false;
    this.trailerDropdownOpen = false;
    this.showColumnPicker = false;
    this.showSavedViewsMenu = false;
    this.densityMenuOpen = false;
    this.statusMenuLoadId = null;
    this.billingMenuLoadId = null;
    // Notes editor commits on blur, which fires before this handler — safe to
    // clear here too in case blur was skipped (e.g. clicking a non-focusable area).
    this.editingNotesLoadId = null;
    this.editingNotesDraft = '';
  }

  // FN-745: Page-level drop handler for multi-PDF bulk extraction
  @HostListener('document:dragover', ['$event'])
  onPageDragOver(event: DragEvent): void {
    // Prevent default to allow drops on the page
    event.preventDefault();
  }

  @HostListener('document:drop', ['$event'])
  onPageDrop(event: DragEvent): void {
    // Skip if a modal is already open or we're inside a specific dropzone
    if (this.showBulkUploadModal || this.showAutoModal || this.showBulkExtractionGrid || this.showManualModal || this.showLoadWizard) {
      return;
    }
    const files = event.dataTransfer?.files;
    if (!files || files.length < 2) return;
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf');
    if (pdfs.length >= 2 && pdfs.length <= 10) {
      event.preventDefault();
      this.openBulkExtractionGrid(pdfs);
    }
  }

  // Auto-create from PDF handlers

  onAutoFileSelected(files: FileList | null): void {
    this.autoError = '';
    this.autoPdfFile = files && files.length > 0 ? files[0] : null;
  }

  runAutoExtraction(): void {
    this.autoError = '';
    if (!this.autoPdfFile) {
      this.autoError = 'Please select a PDF file first.';
      return;
    }
    this.autoExtracting = true;
    this.loadsService.aiExtractFromPdf(this.autoPdfFile).subscribe({
      next: (res) => {
        this.autoExtracting = false;
        const data = res?.data;
        if (!data) {
          this.autoError = 'Extraction returned no data. You can continue with manual entry.';
          // Queue attachment and open manual entry anyway
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Uploaded via Auto-Create'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }
        this.autoExtraction = data;

        // If the backend reports no text / vision-only PDF, surface that clearly.
        if (data.provider === 'none' && data.warning) {
          this.autoError = data.warning;
          // Attach the PDF but keep the user in manual mode.
          this.pendingAttachments.push({
            file: this.autoPdfFile as File,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (scanned PDF - manual entry)'
          });
          this.showAutoModal = false;
          this.showManualModal = true;
          return;
        }

        // Normal case: we have structured extraction to apply.
        this.pendingAttachments.push({
          file: this.autoPdfFile as File,
          type: 'RATE_CONFIRMATION',
          notes: 'Rate confirmation (Auto-Create PDF)'
        });
        this.applyExtractionToForm(data);
        this.showAutoModal = false;
        this.showManualModal = true;
      },
      error: (err) => {
        console.error('AI extract failed', err);
        this.autoExtracting = false;
        this.autoError =
          'Failed to extract from PDF. You can still create the load manually and the PDF will be attached.';
        // Still attach the PDF and open manual entry so the user can continue.
        if (this.autoPdfFile) {
          this.pendingAttachments.push({
            file: this.autoPdfFile,
            type: 'RATE_CONFIRMATION',
            notes: 'Rate confirmation (Auto-Create PDF)'
          });
        }
        this.showAutoModal = false;
        this.showManualModal = true;
      }
    });
  }

  // ─── FN-794: Intelligence panel metrics + handlers ──────────────────────

  /** Map an Intelligence period pill to the existing `grossPeriod` values. */
  private mapIntelPeriodToGrossPeriod(p: IntelligencePeriod): string {
    switch (p) {
      case 'today': return 'today';
      case 'week':  return 'this_week';
      case 'month': return 'this_month';
      case 'all':   return 'all';
    }
  }

  /** True when a load should count as "needs attention" (drafts + overdue + needs_review). */
  isNeedsAttention(load: LoadListItem): boolean {
    const status = (load.status || '').toString().toUpperCase();
    if (status === 'DRAFT') { return true; }
    if ((load as any).needs_review) { return true; }
    // Overdue: has a delivery date in the past but is still open.
    const dDate = (load as any).delivery_date || (load as any).last_delivery_date;
    if (dDate && status !== 'DELIVERED' && status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'CANCELED') {
      const d = new Date(dDate);
      if (!Number.isNaN(d.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (d.getTime() < today.getTime()) { return true; }
      }
    }
    return false;
  }

  /** Aggregate the 4 Intelligence metrics from a list of loads. */
  private _aggregateIntelligence(loads: LoadListItem[]): {
    gross: number; delivered: number; inTransit: number; needsAttention: number;
  } {
    let gross = 0;
    let delivered = 0;
    let inTransit = 0;
    let needsAttention = 0;
    for (const l of loads) {
      const r = l.rate != null ? Number(l.rate) : 0;
      gross += Number.isFinite(r) ? r : 0;
      const s = (l.status || '').toString().toUpperCase();
      if (s === 'DELIVERED' || s === 'COMPLETED') { delivered += 1; }
      if (s === 'IN_TRANSIT' || s === 'EN_ROUTE' || s === 'PICKED_UP' || s === 'DISPATCHED') { inTransit += 1; }
      if (this.isNeedsAttention(l)) { needsAttention += 1; }
    }
    return { gross, delivered, inTransit, needsAttention };
  }

  /** Build `intelligenceMetrics` from the current page + cached previous-period aggregate. */
  private recomputeIntelligenceMetrics(): void {
    const curr = this._aggregateIntelligence(this.loads || []);
    const prev = this.prevIntelligenceAggregate;
    this.intelligenceMetrics = {
      gross:          { current: curr.gross,          previous: prev ? prev.gross          : null },
      delivered:      { current: curr.delivered,      previous: prev ? prev.delivered      : null },
      inTransit:      { current: curr.inTransit,      previous: prev ? prev.inTransit      : null },
      needsAttention: { current: curr.needsAttention, previous: prev ? prev.needsAttention : null },
    };
  }

  /** Fetch the previous equivalent period so trend arrows are meaningful. */
  private fetchPreviousPeriodForTrend(): void {
    const range = this._previousIntelligencePeriodRange();
    if (!range) {
      this.prevIntelligenceAggregate = null;
      this.recomputeIntelligenceMetrics();
      return;
    }
    // A single pass — pageSize 500 covers nearly every realistic period without paging.
    this.loadsService.listLoads({
      dateFrom: range.dateFrom,
      dateTo:   range.dateTo,
      page: 1,
      pageSize: 500,
    }).subscribe({
      next: (res) => {
        this.prevIntelligenceAggregate = this._aggregateIntelligence(res?.data || []);
        this.recomputeIntelligenceMetrics();
      },
      error: () => {
        this.prevIntelligenceAggregate = null;
        this.recomputeIntelligenceMetrics();
      }
    });
  }

  /** Date range for the equivalent period immediately before `intelligencePeriod`. */
  private _previousIntelligencePeriodRange(): { dateFrom: string; dateTo: string } | null {
    const toStr = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const now = new Date();
    switch (this.intelligencePeriod) {
      case 'today': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        return { dateFrom: toStr(y), dateTo: toStr(y) };
      }
      case 'week': {
        // Previous ISO-ish week (Mon–Sun before the current one).
        const startOfThisWeek = new Date(now);
        const dow = startOfThisWeek.getDay() || 7; // Sun=0 → 7
        startOfThisWeek.setDate(startOfThisWeek.getDate() - (dow - 1));
        const endPrev = new Date(startOfThisWeek);
        endPrev.setDate(endPrev.getDate() - 1);
        const startPrev = new Date(endPrev);
        startPrev.setDate(startPrev.getDate() - 6);
        return { dateFrom: toStr(startPrev), dateTo: toStr(endPrev) };
      }
      case 'month': {
        const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endPrev = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
        return { dateFrom: toStr(startPrev), dateTo: toStr(endPrev) };
      }
      case 'all':
      default:
        return null;
    }
  }

  /** Handler: user clicked a period pill. */
  onIntelligencePeriodChange(period: IntelligencePeriod): void {
    this.intelligencePeriod = period;
    this.grossPeriod = this.mapIntelPeriodToGrossPeriod(period);
    this.page = 1;
    this.loadLoads();
    this.fetchPreviousPeriodForTrend();
  }

  /** Handler: user clicked the Needs Attention card → toggle client-side filter. */
  onIntelligenceNeedsAttentionClick(): void {
    this.needsAttentionActive = !this.needsAttentionActive;
    this.page = 1;
  }

  // Recompute gross totals on the current page for dashboard summary
  private recomputeSummaryTotals(): void {
    const byStatus: { [key: string]: number } = {};
    const byBilling: { [key: string]: number } = {};
    let total = 0;

    (this.loads || []).forEach((load) => {
      const rate = load.rate != null ? Number(load.rate) : 0;
      total += rate;
      const statusKey = (load.status || '').toString().toUpperCase();
      const billingKey = (load.billing_status || '').toString().toUpperCase();
      if (statusKey) {
        byStatus[statusKey] = (byStatus[statusKey] || 0) + rate;
      }
      if (billingKey) {
        byBilling[billingKey] = (byBilling[billingKey] || 0) + rate;
      }
    });

    this.summaryTotals = {
      totalGross: total,
      byStatus,
      byBilling
    };
  }

  // FN-766: stable identity for cdk-virtual-scroll-viewport row recycling
  trackByLoadId(_index: number, load: LoadListItem): string {
    return load.id;
  }

  // Apply header row filters client-side on the current page of loads
  get filteredLoads(): LoadListItem[] {
    const hf = this.headerFilters;
    return (this.loads || []).filter((load) => {
      // FN-794: Needs Attention card filter (drafts + overdue + needs_review)
      if (this.needsAttentionActive && !this.isNeedsAttention(load)) { return false; }

      // Date filter on pickup_date or delivery/completed date
      if (hf.date) {
        const filterStr = hf.date.toString();
        const dateStr = (load.pickup_date || load.delivery_date || load.completed_date || '').toString();
        if (!dateStr.includes(filterStr)) return false;
      }

      if (hf.broker) {
        const broker = (load.broker_name || '').toString().toLowerCase();
        if (!broker.includes(hf.broker.toLowerCase())) return false;
      }

      if (hf.po) {
        const po = (load.po_number || '').toString().toLowerCase();
        if (!po.includes(hf.po.toLowerCase())) return false;
      }

      if (hf.pickup) {
        const pickupLoc = `${load.pickup_city || ''} ${load.pickup_state || ''}`.toLowerCase();
        if (!pickupLoc.includes(hf.pickup.toLowerCase())) return false;
      }

      if (hf.delivery) {
        const deliveryLoc = `${load.delivery_city || ''} ${load.delivery_state || ''}`.toLowerCase();
        if (!deliveryLoc.includes(hf.delivery.toLowerCase())) return false;
      }

      if (hf.rate) {
        const rateStr = load.rate != null ? String(load.rate) : '';
        if (!rateStr.includes(hf.rate)) return false;
      }

      if (hf.completed) {
        const completedStr = (load.completed_date || '').toString();
        if (!completedStr.includes(hf.completed)) return false;
      }

      if (hf.driver) {
        const driverName = (load.driver_name || '').toString().toLowerCase();
        if (!driverName.includes(hf.driver.toLowerCase())) return false;
      }

      if (hf.status) {
        const statusText = (load.status || '').toString().toLowerCase().replace(/_/g, ' ');
        if (!statusText.includes(hf.status.toLowerCase())) return false;
      }

      if (hf.billingStatus) {
        const billingText = (load.billing_status || '').toString().toLowerCase().replace(/_/g, ' ');
        if (!billingText.includes(hf.billingStatus.toLowerCase())) return false;
      }

      if (hf.attachmentType) {
        const types = Array.isArray(load.attachment_types) ? load.attachment_types : [];
        const typesText = types.join(' ').toLowerCase().replace(/_/g, ' ');
        if (!typesText.includes(hf.attachmentType.toLowerCase())) return false;
      }

      return true;
    });
  }

  // Active filter chips for UI summary
  get activeFilterChips(): Array<{
    key: string;
    label: string;
    value: string;
    kind: 'header' | 'status' | 'billing' | 'driver' | 'needs_review' | 'source';
  }> {
    const chips: Array<{
      key: string;
      label: string;
      value: string;
      kind: 'header' | 'status' | 'billing' | 'driver' | 'needs_review' | 'source';
    }> = [];

    // Header filters
    (Object.keys(this.headerFilters) as Array<keyof typeof this.headerFilters>).forEach((key) => {
      const value = (this.headerFilters[key] || '').toString().trim();
      if (!value) return;
      chips.push({
        key,
        label: this.headerFilterLabels[key],
        value,
        kind: 'header'
      });
    });

    // Status filter
    if (this.filters.status) {
      chips.push({
        key: 'status',
        label: 'Status',
        value: this.filters.status.replace('_', ' '),
        kind: 'status'
      });
    }

    // Billing filter
    if (this.filters.billingStatus) {
      chips.push({
        key: 'billingStatus',
        label: 'Billing',
        value: this.filters.billingStatus.replace('_', ' '),
        kind: 'billing'
      });
    }

    // Driver filter
    if (this.filters.driverId) {
      const driver = this.drivers.find((d) => d.id === this.filters.driverId);
      chips.push({
        key: 'driverId',
        label: 'Driver',
        value: driver?.name || 'Selected driver',
        kind: 'driver'
      });
    }

    // FN-746: Needs review filter
    if (this.filters.needsReview) {
      chips.push({
        key: 'needsReview',
        label: 'Filter',
        value: 'Needs review',
        kind: 'needs_review'
      });
    }

    // FN-762: Source filter (email-sourced loads)
    if (this.filters.source) {
      chips.push({
        key: 'source',
        label: 'Source',
        value: this.filters.source === 'email' ? 'Email' : this.filters.source,
        kind: 'source'
      });
    }

    return chips;
  }

  clearFilterChip(chip: { key: string; kind: 'header' | 'status' | 'billing' | 'driver' | 'needs_review' | 'source' }): void {
    if (chip.kind === 'header') {
      this.headerFilters = {
        ...this.headerFilters,
        [chip.key]: ''
      };
      return;
    }

    if (chip.kind === 'status') {
      this.filters.status = '';
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'billing') {
      this.filters.billingStatus = '';
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'driver') {
      this.filters.driverId = '';
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'needs_review') {
      this.filters.needsReview = false;
      this.page = 1;
      this.loadLoads();
      return;
    }

    if (chip.kind === 'source') {
      this.filters.source = '';
      this.page = 1;
      this.loadLoads();
    }
  }

  clearAllFilters(): void {
    this.headerFilters = {
      date: '',
      driver: '',
      broker: '',
      po: '',
      pickup: '',
      delivery: '',
      rate: '',
      completed: '',
      status: '',
      billingStatus: '',
      attachmentType: ''
    };

    this.filters = {
      ...this.filters,
      status: '',
      billingStatus: '',
      driverId: '',
      needsReview: false,
      source: ''
    };

    // FN-798: "Clear all" must also drop every active smart-filter chip.
    this.smartFilterKeys = [];

    this.page = 1;
    this.loadLoads();
  }

  // ─── FN-767: Column visibility + saved views + inline status ───────────────

  private initColumnVisibility(): void {
    this.visibleColumns = this.columnDefs.reduce<Record<string, boolean>>((acc, col) => {
      acc[col.key] = true;
      return acc;
    }, {});
  }

  private loadUserPreferences(): void {
    this.userPreferences.load().pipe(takeUntil(this.destroy$)).subscribe(() => {
      const prefs = this.userPreferences.getLoadsDashboardPrefs();
      if (prefs.columnVisibility) {
        for (const col of this.columnDefs) {
          if (col.alwaysVisible) {
            this.visibleColumns[col.key] = true;
            continue;
          }
          if (prefs.columnVisibility[col.key] === false) {
            this.visibleColumns[col.key] = false;
          }
        }
      }
      this.savedViews = Array.isArray(prefs.savedViews) ? [...prefs.savedViews] : [];
      if (this.savedViews.length === 0) {
        this.savedViews = this.defaultSavedViews();
      }
      // FN-808: restore persisted drawer width if within supported range.
      if (typeof prefs.drawerWidth === 'number') {
        const w = Math.min(DRAWER_MAX_WIDTH, Math.max(DRAWER_MIN_WIDTH, Math.round(prefs.drawerWidth)));
        this.drawerWidth = w;
      }
      // FN-821: restore persisted density mode; defaults to 'comfortable' otherwise.
      if (prefs.density === 'compact' || prefs.density === 'comfortable' || prefs.density === 'spacious') {
        this.densityMode = prefs.density;
      }
    });
  }

  // ─── FN-808: Load Detail Side Drawer handlers ─────────────────────────────

  /**
   * Row-click handler. Opens the drawer for the given load unless the click
   * originated inside an interactive control (checkbox, action button,
   * status dropdown, etc.) — those stop propagation at their own cell.
   */
  onRowClick(load: LoadListItem, event: Event): void {
    // Guard: if the event bubbled up from an interactive target, ignore it.
    // Individual cells (checkbox, actions, status dropdown) already call
    // $event.stopPropagation(), but we also defensively ignore clicks on
    // <a>, <button>, <input>, <select>, <textarea>.
    const target = event.target as HTMLElement | null;
    if (target && target.closest('a, button, input, select, textarea, [role="button"]')) {
      return;
    }
    this.openLoadDrawer(load.id);
  }

  openLoadDrawer(loadId: string, focusLowConfidence = false): void {
    this.drawerFocusLowConfidence = focusLowConfidence;
    this.drawerLoadId = loadId;
  }

  closeLoadDrawer(): void {
    this.drawerLoadId = null;
    this.drawerFocusLowConfidence = false;
  }

  /** Step to the previous load in the currently filtered list (wraps). */
  onDrawerPrev(): void {
    if (!this.drawerLoadId) { return; }
    const rows = this.filteredLoads;
    if (!rows.length) { return; }
    const idx = rows.findIndex((l) => l.id === this.drawerLoadId);
    const prevIdx = idx <= 0 ? rows.length - 1 : idx - 1;
    this.drawerLoadId = rows[prevIdx].id;
  }

  /** Step to the next load in the currently filtered list (wraps). */
  onDrawerNext(): void {
    if (!this.drawerLoadId) { return; }
    const rows = this.filteredLoads;
    if (!rows.length) { return; }
    const idx = rows.findIndex((l) => l.id === this.drawerLoadId);
    const nextIdx = idx < 0 || idx === rows.length - 1 ? 0 : idx + 1;
    this.drawerLoadId = rows[nextIdx].id;
  }

  /** Drawer header "expand to modal" — hand off to the existing wizard flow. */
  onDrawerExpand(): void {
    if (!this.drawerLoadId) { return; }
    const id = this.drawerLoadId;
    this.closeLoadDrawer();
    this.openLoadWizardForEdit(id);
  }

  /** Persist the new width once the user finishes dragging the resize handle. */
  onDrawerWidthChange(width: number): void {
    this.drawerWidth = width;
    this.userPreferences.patchLoadsDashboard({ drawerWidth: width }).subscribe();
  }

  /** After drawer save, refresh the list so card changes are reflected. */
  onDrawerSaved(): void {
    this.successMessage = 'Load saved.';
    setTimeout(() => (this.successMessage = ''), 2500);
    this.loadLoads();
  }

  /** True when the current drawerLoadId is the first row of filteredLoads. */
  get drawerHasPrev(): boolean {
    return !!this.drawerLoadId && this.filteredLoads.length > 1;
  }

  /** True when the current drawerLoadId is not the last row of filteredLoads. */
  get drawerHasNext(): boolean {
    return !!this.drawerLoadId && this.filteredLoads.length > 1;
  }

  /** Returns true when `load` is the active row highlighted with the teal border. */
  isDrawerActive(load: LoadListItem): boolean {
    return !!this.drawerLoadId && load.id === this.drawerLoadId;
  }

  /** Default seed views shown on first use; not persisted until user saves/edits. */
  private defaultSavedViews(): LoadsSavedView[] {
    return [
      {
        id: 'default-my-drafts',
        name: 'My Drafts',
        filters: { status: 'DRAFT' },
        sortBy: 'pickup_date',
        sortDir: 'desc'
      },
      {
        id: 'default-this-week',
        name: 'This Week',
        filters: {},
        sortBy: 'pickup_date',
        sortDir: 'desc'
      },
      {
        id: 'default-unpaid',
        name: 'Unpaid',
        filters: { billingStatus: 'PENDING' },
        sortBy: 'pickup_date',
        sortDir: 'desc'
      }
    ];
  }

  isColVisible(key: string): boolean {
    return this.visibleColumns[key] !== false;
  }

  /** Number of currently visible columns — used for empty-state colspan. */
  get visibleColumnCount(): number {
    return this.columnDefs.reduce((n, c) => n + (this.isColVisible(c.key) ? 1 : 0), 0);
  }

  toggleColumnPicker(): void {
    this.showColumnPicker = !this.showColumnPicker;
    if (this.showColumnPicker) this.showSavedViewsMenu = false;
  }

  toggleColumnVisible(key: string): void {
    const def = this.columnDefs.find(c => c.key === key);
    if (!def || def.alwaysVisible) return;
    this.visibleColumns[key] = !this.isColVisible(key);
    this.persistColumnVisibility();
  }

  private persistColumnVisibility(): void {
    const payload: Record<string, boolean> = {};
    for (const col of this.columnDefs) {
      if (col.alwaysVisible) continue;
      payload[col.key] = this.isColVisible(col.key);
    }
    this.userPreferences.patchLoadsDashboard({ columnVisibility: payload }).subscribe();
  }

  toggleSavedViewsMenu(): void {
    this.showSavedViewsMenu = !this.showSavedViewsMenu;
    if (this.showSavedViewsMenu) this.showColumnPicker = false;
  }

  applySavedView(view: LoadsSavedView): void {
    this.filters = {
      status: view.filters.status || '',
      billingStatus: view.filters.billingStatus || '',
      driverId: view.filters.driverId || '',
      q: view.filters.q || '',
      needsReview: !!view.filters.needsReview,
      source: view.filters.source || ''
    };
    if (view.sortBy) this.sortBy = view.sortBy as any;
    if (view.sortDir) this.sortDir = view.sortDir;
    this.page = 1;
    this.showSavedViewsMenu = false;
    this.loadLoads();
  }

  saveCurrentAsView(): void {
    const name = (this.newViewName || '').trim();
    if (!name) return;
    const view: LoadsSavedView = {
      id: `view-${Date.now()}`,
      name,
      filters: {
        status: this.filters.status || undefined,
        billingStatus: this.filters.billingStatus || undefined,
        driverId: this.filters.driverId || undefined,
        q: this.filters.q || undefined,
        needsReview: this.filters.needsReview || undefined,
        source: this.filters.source || undefined
      },
      sortBy: this.sortBy,
      sortDir: this.sortDir
    };
    this.savedViews = [...this.savedViews, view];
    this.newViewName = '';
    this.persistSavedViews();
  }

  deleteSavedView(id: string): void {
    this.savedViews = this.savedViews.filter(v => v.id !== id);
    this.persistSavedViews();
  }

  private persistSavedViews(): void {
    this.userPreferences.patchLoadsDashboard({ savedViews: this.savedViews }).subscribe();
  }

  openStatusMenu(loadId: string | undefined | null, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!loadId) return;
    this.statusMenuLoadId = this.statusMenuLoadId === loadId ? null : loadId;
    this.billingMenuLoadId = null;
  }

  closeStatusMenu(): void {
    this.statusMenuLoadId = null;
  }

  /** Inline status change — PUTs a single-field update via LoadsService.updateLoad. */
  changeLoadStatus(load: LoadListItem, newStatus: LoadStatus, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.statusMenuLoadId = null;
    if (!load || !load.id) return;
    if (load.status === newStatus) return;

    const previousStatus = load.status;
    load.status = newStatus; // optimistic UI update

    this.loadsService.updateLoad(load.id, { status: newStatus }).subscribe({
      next: (res) => {
        if (res && res.data && res.data.status) {
          load.status = res.data.status as LoadStatus;
        }
        this.successMessage = `Status updated to ${this.getStatusLabel(newStatus)}`;
        setTimeout(() => { this.successMessage = ''; }, 2500);
      },
      error: (err) => {
        load.status = previousStatus;
        this.errorMessage = (err && err.error && err.error.error) || 'Failed to update load status';
        setTimeout(() => { this.errorMessage = ''; }, 4000);
      }
    });
  }

  // ─── FN-805: Inline billing dropdown ──────────────────────────────────────

  openBillingMenu(loadId: string | undefined | null, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!loadId) return;
    this.billingMenuLoadId = this.billingMenuLoadId === loadId ? null : loadId;
    this.statusMenuLoadId = null;
  }

  closeBillingMenu(): void {
    this.billingMenuLoadId = null;
  }

  /** Inline billing change — same PUT pattern as status. */
  changeLoadBilling(load: LoadListItem, newBilling: BillingStatus, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.billingMenuLoadId = null;
    if (!load || !load.id) return;
    if (load.billing_status === newBilling) return;

    const previousBilling = load.billing_status;
    load.billing_status = newBilling;

    this.loadsService.updateLoad(load.id, { billingStatus: newBilling }).subscribe({
      next: (res) => {
        if (res && res.data && res.data.billing_status) {
          load.billing_status = res.data.billing_status as BillingStatus;
        }
        this.successMessage = `Billing updated to ${this.getBillingLabel(newBilling)}`;
        setTimeout(() => { this.successMessage = ''; }, 2500);
      },
      error: (err) => {
        load.billing_status = previousBilling;
        this.errorMessage = (err && err.error && err.error.error) || 'Failed to update billing status';
        setTimeout(() => { this.errorMessage = ''; }, 4000);
      }
    });
  }

  // ─── FN-805: Inline notes edit ────────────────────────────────────────────

  openNotesEditor(load: LoadListItem, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!load || !load.id) return;
    this.editingNotesLoadId = load.id;
    this.editingNotesDraft = load.notes ?? '';
    this.notesSaveInFlight = false;
    this.statusMenuLoadId = null;
    this.billingMenuLoadId = null;
    // Focus the textarea after Angular mounts it via *ngIf.
    setTimeout(() => {
      const el = document.querySelector('.notes-inline__textarea') as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  }

  /** Cancel inline notes edit without saving (Esc). */
  cancelNotesEdit(event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.editingNotesLoadId = null;
    this.editingNotesDraft = '';
    this.notesSaveInFlight = false;
  }

  /** Commit inline notes edit (Enter or blur). Skips network when unchanged. */
  saveNotesEdit(load: LoadListItem, event?: Event): void {
    if (event) {
      event.stopPropagation();
      // Enter should commit, not insert a newline.
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
      }
    }
    if (this.notesSaveInFlight) return;
    if (!load || !load.id) { this.cancelNotesEdit(); return; }
    if (this.editingNotesLoadId !== load.id) return;

    const next = (this.editingNotesDraft ?? '').trim();
    const current = (load.notes ?? '').trim();
    if (next === current) {
      this.cancelNotesEdit();
      return;
    }

    this.notesSaveInFlight = true;
    const previous = load.notes ?? null;
    load.notes = next.length ? next : null;
    const loadId = load.id;

    this.loadsService.updateLoad(loadId, { notes: load.notes }).subscribe({
      next: (res) => {
        if (res && res.data) {
          load.notes = res.data.notes ?? null;
        }
        this.successMessage = 'Notes updated';
        setTimeout(() => { this.successMessage = ''; }, 2000);
        if (this.editingNotesLoadId === loadId) {
          this.editingNotesLoadId = null;
          this.editingNotesDraft = '';
        }
        this.notesSaveInFlight = false;
      },
      error: (err) => {
        load.notes = previous;
        this.errorMessage = (err && err.error && err.error.error) || 'Failed to update notes';
        setTimeout(() => { this.errorMessage = ''; }, 4000);
        if (this.editingNotesLoadId === loadId) {
          this.editingNotesLoadId = null;
          this.editingNotesDraft = '';
        }
        this.notesSaveInFlight = false;
      }
    });
  }
}
