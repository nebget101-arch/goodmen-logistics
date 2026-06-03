import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  FmcsaImportFile,
  FmcsaImportRun,
  FmcsaImportStatus,
  FmcsaImportsService,
} from '../../../services/fmcsa-imports.service';

interface FileOption {
  key: FmcsaImportFile;
  label: string;
  hint: string;
}

const FILE_OPTIONS: FileOption[] = [
  { key: 'census', label: 'Census', hint: 'Carrier registry snapshot (FMCSA_CENSUS)' },
  { key: 'authority', label: 'Authority', hint: 'Operating authority history (FMCSA_AUTHORITY)' },
  { key: 'inspections', label: 'Inspections', hint: 'Roadside inspection records (FMCSA_INSPECTIONS)' },
  { key: 'crashes', label: 'Crashes', hint: 'Reportable crash records (FMCSA_CRASHES)' },
  { key: 'sms', label: 'SMS', hint: 'Safety Measurement System BASIC scores (FMCSA_SMS)' },
];

const POLL_INTERVAL_MS = 5000;
const ACTIVE_STATUSES: ReadonlyArray<FmcsaImportStatus> = ['queued', 'running'];

/**
 * FN-1425 / FN-1458: FleetNeuron-internal admin page for FMCSA reference data imports.
 * Lets internal operators trigger any subset of the five FMCSA importers (URL-based,
 * shipped in FN-1425) **or** upload a bulk CSV/CSV.GZ from disk (FN-1458) when the FMCSA
 * gated download flow is unavailable. Watches the run ledger live until every run leaves
 * the queued/running states.
 */
@Component({
  selector: 'app-fmcsa-imports-admin',
  templateUrl: './fmcsa-imports.component.html',
  styleUrls: ['./fmcsa-imports.component.css'],
})
export class FmcsaImportsAdminComponent implements OnInit, OnDestroy, AfterViewChecked {
  readonly fileOptions = FILE_OPTIONS;

  selected: Record<FmcsaImportFile, boolean> = {
    census: false,
    authority: false,
    inspections: false,
    crashes: false,
    sms: false,
  };

  dryRun = false;
  confirmOpen = false;
  submitting = false;

  loadingHistory = false;
  refreshingHistory = false;
  historyLoaded = false;

  runs: FmcsaImportRun[] = [];
  message = '';
  error = '';

  // ─── Upload modal state (FN-1458) ───────────────────────────────────────
  uploadOpen = false;
  uploadFile: File | null = null;
  uploadFileType: FmcsaImportFile | '' = '';
  uploadDryRun = false;
  uploadInFlight = false;
  uploadProgress = 0;
  uploadError = '';
  private uploadAutoFocused = false;

  @ViewChild('uploadFileInput') uploadFileInputRef?: ElementRef<HTMLInputElement>;

  private listSub: Subscription | null = null;
  private runSub: Subscription | null = null;
  private uploadSub: Subscription | null = null;
  private progressSub: Subscription | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly service: FmcsaImportsService) {}

  ngOnInit(): void {
    this.loadHistory();
    this.progressSub = this.service.uploadProgress$.subscribe((p) => {
      this.uploadProgress = p;
    });
  }

  ngAfterViewChecked(): void {
    if (this.uploadOpen && !this.uploadAutoFocused && this.uploadFileInputRef) {
      this.uploadFileInputRef.nativeElement.focus();
      this.uploadAutoFocused = true;
    }
  }

  ngOnDestroy(): void {
    this.cancelPoll();
    this.listSub?.unsubscribe();
    this.runSub?.unsubscribe();
    this.uploadSub?.unsubscribe();
    this.progressSub?.unsubscribe();
  }

  // ─── Selection ──────────────────────────────────────────────────────────

  toggle(file: FmcsaImportFile): void {
    this.selected[file] = !this.selected[file];
  }

  toggleAll(value: boolean): void {
    for (const opt of FILE_OPTIONS) {
      this.selected[opt.key] = value;
    }
  }

  hasSelection(): boolean {
    return FILE_OPTIONS.some((opt) => this.selected[opt.key]);
  }

  selectedFiles(): FmcsaImportFile[] {
    return FILE_OPTIONS.filter((opt) => this.selected[opt.key]).map((opt) => opt.key);
  }

  // ─── Confirmation modal ─────────────────────────────────────────────────

  openConfirm(): void {
    if (!this.hasSelection() || this.submitting) return;
    this.error = '';
    this.message = '';
    this.confirmOpen = true;
  }

  closeConfirm(): void {
    if (this.submitting) return;
    this.confirmOpen = false;
  }

  // ─── Trigger ────────────────────────────────────────────────────────────

  submit(): void {
    if (!this.hasSelection() || this.submitting) return;
    const files = this.selectedFiles();
    const dryRun = this.dryRun;

    this.submitting = true;
    this.error = '';
    this.message = '';

    this.runSub?.unsubscribe();
    this.runSub = this.service.run({ files, dryRun }).subscribe({
      next: (res) => {
        const count = res?.data?.runIds?.length ?? files.length;
        this.message = dryRun
          ? `Queued ${count} dry-run import${count === 1 ? '' : 's'}.`
          : `Queued ${count} import${count === 1 ? '' : 's'}.`;
        this.confirmOpen = false;
        this.submitting = false;
        this.toggleAll(false);
        this.loadHistory(true);
      },
      error: (err) => {
        this.submitting = false;
        const apiError = err?.error?.error || err?.error?.message;
        this.error = apiError || 'Failed to queue FMCSA import.';
      },
    });
  }

  // ─── Upload modal (FN-1458) ─────────────────────────────────────────────

  openUpload(prefill?: FmcsaImportFile): void {
    if (this.submitting) return;
    this.uploadError = '';
    this.uploadFile = null;
    this.uploadFileType = prefill ?? '';
    this.uploadDryRun = false;
    this.uploadProgress = 0;
    this.uploadInFlight = false;
    this.uploadAutoFocused = false;
    this.message = '';
    this.error = '';
    this.uploadOpen = true;
  }

  closeUpload(): void {
    // ESC / backdrop is ignored while an upload is in-flight to keep the UX simple
    // (no "cancel upload?" prompt). User must wait for the current upload to finish.
    if (this.uploadInFlight) return;
    this.uploadOpen = false;
    this.uploadSub?.unsubscribe();
  }

  onUploadFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile = input.files && input.files.length > 0 ? input.files[0] : null;
    this.uploadError = '';
  }

  uploadSubmitDisabled(): boolean {
    return this.uploadInFlight || !this.uploadFile || !this.uploadFileType;
  }

  submitUpload(): void {
    if (this.uploadSubmitDisabled()) return;
    const file = this.uploadFile!;
    const fileType = this.uploadFileType as FmcsaImportFile;
    const dryRun = this.uploadDryRun;

    this.uploadInFlight = true;
    this.uploadError = '';
    this.uploadProgress = 0;

    this.uploadSub?.unsubscribe();
    this.uploadSub = this.service.runUpload(file, fileType, dryRun).subscribe({
      next: () => {
        this.uploadInFlight = false;
        this.uploadOpen = false;
        this.message = dryRun
          ? `Uploaded ${file.name} (dry-run queued).`
          : `Uploaded ${file.name} — import queued.`;
        this.loadHistory(true);
      },
      error: (err) => {
        this.uploadInFlight = false;
        const apiError = err?.error?.error || err?.error?.message;
        if (err?.status === 413) {
          this.uploadError = apiError || 'File exceeds the 1 GB upload limit.';
        } else if (err?.status === 403) {
          this.uploadError = apiError || 'You are not allowed to upload FMCSA bulk files.';
        } else {
          this.uploadError = apiError || 'Failed to upload FMCSA bulk file.';
        }
      },
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.uploadOpen) {
      this.closeUpload();
    } else if (this.confirmOpen) {
      this.closeConfirm();
    }
  }

  // ─── History + polling ──────────────────────────────────────────────────

  loadHistory(triggeredBySubmit = false): void {
    if (!triggeredBySubmit && this.historyLoaded) {
      this.refreshingHistory = true;
    } else if (!this.historyLoaded) {
      this.loadingHistory = true;
    } else {
      this.refreshingHistory = true;
    }

    this.listSub?.unsubscribe();
    this.listSub = this.service.list().subscribe({
      next: (res) => {
        this.runs = Array.isArray(res?.data) ? res.data : [];
        this.historyLoaded = true;
        this.loadingHistory = false;
        this.refreshingHistory = false;
        this.schedulePoll();
      },
      error: (err) => {
        this.loadingHistory = false;
        this.refreshingHistory = false;
        const apiError = err?.error?.error || err?.error?.message;
        this.error = apiError || 'Failed to load FMCSA import history.';
        this.cancelPoll();
      },
    });
  }

  refresh(): void {
    this.loadHistory(false);
  }

  hasActiveRun(): boolean {
    return this.runs.some((run) => ACTIVE_STATUSES.includes(run.status));
  }

  private schedulePoll(): void {
    this.cancelPoll();
    if (!this.hasActiveRun()) return;
    this.pollHandle = setTimeout(() => {
      this.pollHandle = null;
      this.loadHistory(false);
    }, POLL_INTERVAL_MS);
  }

  private cancelPoll(): void {
    if (this.pollHandle != null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  // ─── Display helpers ────────────────────────────────────────────────────

  fileLabel(file: FmcsaImportFile): string {
    return FILE_OPTIONS.find((opt) => opt.key === file)?.label ?? file;
  }

  statusLabel(status: FmcsaImportStatus): string {
    switch (status) {
      case 'queued': return 'Queued';
      case 'running': return 'Running';
      case 'success': return 'Success';
      case 'error': return 'Error';
      default: return status;
    }
  }

  statusClass(status: FmcsaImportStatus): string {
    return `status-badge status-${status}`;
  }

  triggerLabel(triggeredBy: FmcsaImportRun['triggered_by']): string {
    return triggeredBy === 'cron' ? 'Cron' : 'Manual';
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  }

  formatNumber(value?: number | null): string {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toLocaleString();
  }

  formatRowDelta(run: FmcsaImportRun): string {
    if (run.status !== 'success' && run.status !== 'error') return '—';
    const inserted = this.formatNumber(run.rows_inserted);
    const updated = this.formatNumber(run.rows_updated);
    const skipped = this.formatNumber(run.rows_skipped);
    return `+${inserted} / ~${updated} / ↷${skipped}`;
  }

  formatBytes(value?: number | null): string {
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = value;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
  }
}
