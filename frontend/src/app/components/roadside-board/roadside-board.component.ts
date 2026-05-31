import { Component, OnInit } from '@angular/core';
import { RoadsideService } from '../../services/roadside.service';
import { ToastService } from '../../shared/toast/toast.service';
import { StepperStep } from '../../shared/status-stepper/status-stepper.component';
import { AiSelectOption } from '../../shared/ai-select/ai-select.component';
import { RailTab } from '../../shared/side-rail-tabs/side-rail-tabs.component';
import { firstValueFrom } from 'rxjs';

/** Canonical call lifecycle, in advance order. Drives the status stepper. */
type StepKey = 'NEW' | 'TRIAGED' | 'DISPATCHED' | 'RESOLVED';
const STEP_ORDER: StepKey[] = ['NEW', 'TRIAGED', 'DISPATCHED', 'RESOLVED'];

@Component({
  selector: 'app-roadside-board',
  templateUrl: './roadside-board.component.html',
  styleUrls: ['./roadside-board.component.css']
})
export class RoadsideBoardComponent implements OnInit {
  loading = false;
  saving = false;
  errorMessage = '';
  successMessage = '';

  calls: any[] = [];
  selectedCall: any = null;
  publicLink: string | null = null;
  timeline: any[] = [];
  timelineLocations: any[] = [];
  resolvedDispatchAddress = '';
  resolvingDispatchAddress = false;
  private geocodeCache = new Map<string, string>();

  /** Whether the "Start a new roadside call" panel (hidden behind + New Call) is open. */
  showCreate = false;
  /** Step whose panel is expanded in the detail pane (stepper-driven). */
  activeStepKey: StepKey = 'NEW';
  /** Caller Profile read→edit toggle (inline pencil at the call site). */
  editingCaller = false;
  /** Active side-rail tab on the detail pane. */
  railTab = 'timeline';

  /** Left-rail filters (client-side over the already-loaded list — no new endpoints). */
  filterUrgency = '';
  filterStatus = '';

  triageForm: any = {
    intake_source: 'AI_AGENT',
    symptoms: '',
    recommended_action: '',
    requires_tow: false,
    safety_risk: false,
    confidence_score: 70,
    risk_level: 'LOW'
  };

  dispatchForm: any = {
    assigned_vendor_name: '',
    assigned_vendor_phone: '',
    dispatch_status: 'PENDING',
    eta_minutes: 60,
    notes: ''
  };

  resolveForm: any = {
    resolution: '',
    payment: {
      amount: 0,
      payment_status: 'UNPAID',
      payer_type: 'COMPANY',
      payment_method: 'internal'
    }
  };

  newCall: any = {
    source_channel: 'PHONE',
    urgency: 'NORMAL',
    issue_type: 'OTHER',
    caller_name: '',
    caller_phone: '',
    caller_email: '',
    incident_summary: ''
  };

  // ── Stable option lists for <app-ai-select> ──────────────────────────────
  // Assigned once (never getters) — getter-based [options] cause CD loops (FN-317).
  readonly sourceOptions: AiSelectOption[] = [
    { value: 'PHONE', label: 'Phone' },
    { value: 'SMS', label: 'SMS' },
    { value: 'APP', label: 'App' },
    { value: 'WEB', label: 'Web' },
    { value: 'DISPATCH', label: 'Dispatch' }
  ];
  readonly urgencyOptions: AiSelectOption[] = [
    { value: 'LOW', label: 'Low' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'HIGH', label: 'High' },
    { value: 'CRITICAL', label: 'Critical' }
  ];
  readonly issueOptions: AiSelectOption[] = [
    { value: 'OTHER', label: 'Other' },
    { value: 'FLAT_TIRE', label: 'Flat tire' },
    { value: 'BATTERY', label: 'Battery' },
    { value: 'ENGINE', label: 'Engine' },
    { value: 'BRAKE', label: 'Brake' },
    { value: 'TRANSMISSION', label: 'Transmission' },
    { value: 'ELECTRICAL', label: 'Electrical' },
    { value: 'ACCIDENT', label: 'Accident' },
    { value: 'LOCKOUT', label: 'Lockout' },
    { value: 'FUEL', label: 'Fuel' },
    { value: 'TOW_REQUIRED', label: 'Tow required' }
  ];
  readonly intakeSourceOptions: AiSelectOption[] = [
    { value: 'AI_AGENT', label: 'AI agent' },
    { value: 'HUMAN_AGENT', label: 'Human agent' },
    { value: 'DRIVER_SELF', label: 'Driver self-report' }
  ];
  readonly riskOptions: AiSelectOption[] = [
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
    { value: 'CRITICAL', label: 'Critical' }
  ];
  readonly dispatchStatusOptions: AiSelectOption[] = [
    { value: 'PENDING', label: 'Pending' },
    { value: 'ACCEPTED', label: 'Accepted' },
    { value: 'EN_ROUTE', label: 'En route' },
    { value: 'ARRIVED', label: 'Arrived' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'CANCELED', label: 'Canceled' }
  ];
  readonly paymentStatusOptions: AiSelectOption[] = [
    { value: 'UNPAID', label: 'Unpaid' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'AUTHORIZED', label: 'Authorized' },
    { value: 'PAID', label: 'Paid' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'REFUNDED', label: 'Refunded' }
  ];
  readonly payerOptions: AiSelectOption[] = [
    { value: 'COMPANY', label: 'Company' },
    { value: 'DRIVER', label: 'Driver' },
    { value: 'CUSTOMER', label: 'Customer' },
    { value: 'INSURANCE', label: 'Insurance' },
    { value: 'OTHER', label: 'Other' }
  ];
  readonly urgencyFilterOptions: AiSelectOption[] = [
    { value: '', label: 'Any urgency' },
    ...this.urgencyOptions
  ];
  readonly statusFilterOptions: AiSelectOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'NEW', label: 'New' },
    { value: 'TRIAGED', label: 'Triaged' },
    { value: 'DISPATCHED', label: 'Dispatched' },
    { value: 'RESOLVED', label: 'Resolved' }
  ];

  /** Side-rail tabs on the detail pane. */
  readonly railTabs: RailTab[] = [
    { key: 'timeline', label: 'Timeline', icon: 'timeline' },
    { key: 'location', label: 'Location', icon: 'pin_drop' },
    { key: 'attachments', label: 'Attachments', icon: 'attach_file' },
    { key: 'link', label: 'Public Link', icon: 'link' }
  ];

  /** Stepper steps rebuilt whenever the selected call's status changes. */
  stepperSteps: StepperStep[] = [];

  /** Placeholder skeleton rows rendered while the call list loads. */
  readonly skeletonRows = [0, 1, 2, 3];

  constructor(
    private roadsideService: RoadsideService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.loadCalls();
  }

  // ── Derived view state ───────────────────────────────────────────────────

  /** Canonical lifecycle step for the selected call's raw status string. */
  get currentStepKey(): StepKey {
    return this.stepKeyForStatus(this.selectedCall?.status);
  }

  private stepKeyForStatus(status: string): StepKey {
    const s = String(status || 'NEW').toUpperCase();
    if (/(RESOLVED|CLOSED|COMPLETED)/.test(s)) return 'RESOLVED';
    if (/(DISPATCH|EN_ROUTE|ARRIVED)/.test(s)) return 'DISPATCHED';
    if (/TRIAG/.test(s)) return 'TRIAGED';
    return 'NEW';
  }

  /** Calls filtered by the left-rail urgency/status selects (client-side only). */
  get filteredCalls(): any[] {
    return this.calls.filter((c) => {
      const urgencyOk =
        !this.filterUrgency ||
        String(c.urgency || '').toUpperCase() === this.filterUrgency;
      const statusOk =
        !this.filterStatus || this.stepKeyForStatus(c.status) === this.filterStatus;
      return urgencyOk && statusOk;
    });
  }

  /** Completed steps (everything before the current one), for summary chips. */
  get completedSteps(): StepperStep[] {
    const currentIndex = STEP_ORDER.indexOf(this.currentStepKey);
    return this.stepperSteps.filter((_s, i) => i < currentIndex);
  }

  private rebuildSteps(): void {
    const currentIndex = STEP_ORDER.indexOf(this.currentStepKey);
    const detailFor: Record<StepKey, string> = {
      NEW: this.callerSummaryLine,
      TRIAGED: this.triageSummaryLine,
      DISPATCHED: this.dispatchSummaryLine,
      RESOLVED: this.resolveSummaryLine
    };
    const labelFor: Record<StepKey, string> = {
      NEW: 'New',
      TRIAGED: 'Triaged',
      DISPATCHED: 'Dispatched',
      RESOLVED: 'Resolved'
    };
    this.stepperSteps = STEP_ORDER.map((key, i) => ({
      key,
      label: labelFor[key],
      kicker: `Step ${i + 1}`,
      value: detailFor[key],
      status: i < currentIndex ? 'complete' : i === currentIndex ? 'current' : 'pending'
    }));
    this.activeStepKey = this.currentStepKey;
  }

  // ── Summary lines for stepper values + collapsed chips ────────────────────
  get callerSummaryLine(): string {
    const c = this.selectedCall;
    if (!c) return '';
    return (
      [c.caller_name, c.caller_phone].filter(Boolean).join(' · ') ||
      'Caller info captured'
    );
  }
  get triageSummaryLine(): string {
    const c = this.selectedCall;
    const action = c?.triage?.recommended_action || c?.recommended_action;
    if (!action && this.stepKeyForStatus(c?.status) === 'NEW') return 'Triage pending';
    return action || 'Triage applied';
  }
  get dispatchSummaryLine(): string {
    const d = this.selectedCall?.dispatch;
    if (!d) return 'No dispatch yet';
    return [
      d.assigned_vendor_name || 'Vendor TBD',
      d.eta_minutes != null ? `ETA ${d.eta_minutes} min` : null
    ]
      .filter(Boolean)
      .join(' · ');
  }
  get resolveSummaryLine(): string {
    const c = this.selectedCall;
    return c?.resolution || c?.resolved_at ? 'Call closed' : 'Not resolved';
  }

  // ── Stepper / panel navigation ────────────────────────────────────────────
  onStepChange(key: string): void {
    if ((STEP_ORDER as string[]).includes(key)) {
      this.activeStepKey = key as StepKey;
      if (key === 'NEW') this.editingCaller = false;
    }
  }

  editStep(key: string): void {
    if (!(STEP_ORDER as string[]).includes(key)) return;
    this.activeStepKey = key as StepKey;
    if (key === 'NEW') this.editingCaller = true;
  }

  onRailTabChange(key: string): void {
    this.railTab = key;
  }

  openCreate(): void {
    this.showCreate = true;
    this.selectedCall = null;
  }

  closeCreate(): void {
    this.showCreate = false;
  }

  toggleEditCaller(): void {
    this.editingCaller = !this.editingCaller;
  }

  // ── Data operations (endpoints unchanged) ────────────────────────────────

  loadCalls(): void {
    this.loading = true;
    this.errorMessage = '';
    this.roadsideService.listCalls({ limit: 50 }).subscribe({
      next: (rows) => {
        this.calls = Array.isArray(rows) ? rows : [];
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to load roadside calls';
        this.loading = false;
      }
    });
  }

  createCall(): void {
    this.saving = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.roadsideService.createCall(this.newCall).subscribe({
      next: (created) => {
        this.saving = false;
        this.toast.success(`Roadside call created: ${created.call_number}`);
        this.newCall = {
          source_channel: 'PHONE',
          urgency: 'NORMAL',
          issue_type: 'OTHER',
          caller_name: '',
          caller_phone: '',
          caller_email: '',
          incident_summary: ''
        };
        this.showCreate = false;
        this.loadCalls();
      },
      error: (err) => {
        this.saving = false;
        this.errorMessage = err?.error?.error || 'Failed to create roadside call';
      }
    });
  }

  selectCall(callId: string): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.publicLink = null;
    this.showCreate = false;
    this.editingCaller = false;
    this.railTab = 'timeline';
    this.roadsideService.getCall(callId).subscribe({
      next: (call) => {
        this.selectedCall = call;
        this.dispatchForm = {
          assigned_vendor_name: call?.dispatch?.assigned_vendor_name || '',
          assigned_vendor_phone: call?.dispatch?.assigned_vendor_phone || '',
          dispatch_status: call?.dispatch?.dispatch_status || 'PENDING',
          eta_minutes: call?.dispatch?.eta_minutes ?? 60,
          notes: call?.dispatch?.notes || ''
        };
        this.rebuildSteps();
        this.resolveDispatchAddressFromSnapshot();
        this.loadTimeline();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to load roadside call details';
      }
    });
  }

  refreshSelectedCall(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.getCall(this.selectedCall.id).subscribe({
      next: (call) => {
        this.selectedCall = call;
        this.rebuildSteps();
        this.loadTimeline();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to refresh call details';
      }
    });
  }

  createPublicLink(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.createPublicLink(this.selectedCall.id, { ttl_hours: 48 }).subscribe({
      next: (res: any) => {
        this.publicLink = res?.url || null;
        this.toast.success('Public link generated.');
      },
      error: (err: any) => {
        this.errorMessage = err?.error?.error || 'Failed to create public link';
      }
    });
  }

  setStatus(status: string): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.setStatus(this.selectedCall.id, status).subscribe({
      next: (row: any) => {
        this.selectedCall = { ...this.selectedCall, ...row };
        this.rebuildSteps();
        this.loadCalls();
      },
      error: (err: any) => {
        this.errorMessage = err?.error?.error || 'Failed to update status';
      }
    });
  }

  applyTriage(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.triage(this.selectedCall.id, this.triageForm).subscribe({
      next: (updated) => {
        this.selectedCall = updated;
        this.toast.success('Triage saved. Ready to dispatch.');
        this.rebuildSteps();
        this.loadCalls();
        this.loadTimeline();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to apply triage';
      }
    });
  }

  assignDispatch(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.assignDispatch(this.selectedCall.id, this.dispatchForm).subscribe({
      next: (updated) => {
        this.selectedCall = updated;
        this.toast.success('Dispatch assignment saved.');
        this.rebuildSteps();
        this.loadCalls();
        this.loadTimeline();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to assign dispatch';
      }
    });
  }

  resolveSelectedCall(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.resolveCall(this.selectedCall.id, this.resolveForm).subscribe({
      next: (updated) => {
        this.selectedCall = updated;
        this.toast.success('Call closed. Logged to timeline.');
        this.rebuildSteps();
        this.loadCalls();
        this.loadTimeline();
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to resolve call';
      }
    });
  }

  autoCreateWorkOrder(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService
      .linkWorkOrder(this.selectedCall.id, {
        auto_create_work_order: true,
        vehicle_id: this.selectedCall.unit_id,
        customer_id: this.selectedCall.customer_id,
        work_order_description: this.selectedCall.incident_summary || `Roadside ${this.selectedCall.call_number}`
      })
      .subscribe({
        next: (link) => {
          this.toast.success(
            link?.work_order_id
              ? `Work order linked: ${link.work_order_id}`
              : `Work order link status: ${link?.link_status || 'PENDING'}`
          );
          this.selectCall(this.selectedCall.id);
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || 'Failed to auto-create work order';
        }
      });
  }

  async onUploadPrivateMedia(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !this.selectedCall?.id) return;

    this.errorMessage = '';
    this.successMessage = '';

    try {
      const signed: any = await firstValueFrom(this.roadsideService.createMediaUploadUrl(this.selectedCall.id, {
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        media_type: 'PHOTO'
      }));

      await this.roadsideService.uploadFileToSignedUrl(signed.upload_url, file);

      await firstValueFrom(this.roadsideService.attachPrivateMedia(this.selectedCall.id, {
        storage_key: signed.storage_key,
        media_type: signed.media_type || 'PHOTO',
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        metadata: { file_name: file.name }
      }));

      this.toast.success('Media uploaded and attached.');
      this.selectCall(this.selectedCall.id);
    } catch (error: any) {
      this.errorMessage = error?.message || 'Failed to upload media';
    } finally {
      input.value = '';
    }
  }

  loadTimeline(): void {
    if (!this.selectedCall?.id) return;
    this.roadsideService.getTimeline(this.selectedCall.id).subscribe({
      next: (data) => {
        this.timeline = Array.isArray(data?.events) ? data.events : [];
        const rawLocations = Array.isArray(data?.locations) ? data.locations : [];
        this.timelineLocations = rawLocations.map((l: any) => ({
          ...l,
          resolved_address: ''
        }));
        this.resolveTimelineLocationAddresses();
      },
      error: () => {
        this.timeline = [];
        this.timelineLocations = [];
      }
    });
  }

  get submittedDriverDetails(): any {
    const s = this.selectedCall?.location_snapshot || {};
    return {
      company_name: s.company_name || null,
      payment_contact_name: s.payment_contact_name || null,
      payment_email: s.payment_email || null,
      payment_phone: s.payment_phone || null,
      unit_number: s.unit_number || null,
      dispatch_location_label: s.dispatch_location_label || null
    };
  }

  get hasSubmittedDriverDetails(): boolean {
    const d = this.submittedDriverDetails;
    return Object.values(d).some((v) => !!v);
  }

  get dispatchGeo(): { latitude: number; longitude: number } | null {
    const geo = this.selectedCall?.location_snapshot?.shared_location;
    if (!geo) return null;
    const lat = Number(geo.latitude);
    const lng = Number(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng };
  }

  get dispatchMapUrl(): string {
    const geo = this.dispatchGeo;
    if (!geo) return '';
    const { latitude, longitude } = geo;
    const delta = 0.01;
    const left = longitude - delta;
    const right = longitude + delta;
    const top = latitude + delta;
    const bottom = latitude - delta;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latitude}%2C${longitude}`;
  }

  get dispatchMapsExternalUrl(): string {
    const geo = this.dispatchGeo;
    if (!geo) return '';
    return `https://www.openstreetmap.org/?mlat=${geo.latitude}&mlon=${geo.longitude}#map=14/${geo.latitude}/${geo.longitude}`;
  }

  private resolveDispatchAddressFromSnapshot(): void {
    const loc = this.selectedCall?.location_snapshot?.shared_location;
    if (!loc || !Number.isFinite(Number(loc.latitude)) || !Number.isFinite(Number(loc.longitude))) {
      this.resolvedDispatchAddress = '';
      return;
    }

    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    this.resolvingDispatchAddress = true;
    this.resolveAddress(lat, lng)
      .then((address) => {
        this.resolvedDispatchAddress = address;
      })
      .finally(() => {
        this.resolvingDispatchAddress = false;
      });
  }

  private async resolveTimelineLocationAddresses(): Promise<void> {
    const top = this.timelineLocations.slice(0, 5);
    for (const row of top) {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // eslint-disable-next-line no-await-in-loop
      row.resolved_address = await this.resolveAddress(lat, lng);
    }
    this.timelineLocations = [...this.timelineLocations];
  }

  private async resolveAddress(lat: number, lng: number): Promise<string> {
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.geocodeCache.has(key)) return this.geocodeCache.get(key) || '';

    try {
      const response: any = await firstValueFrom(this.roadsideService.reverseGeocode(lat, lng));
      const address = response?.display_name || `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
      this.geocodeCache.set(key, address);
      return address;
    } catch (_error) {
      const fallback = `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
      this.geocodeCache.set(key, fallback);
      return fallback;
    }
  }
}
