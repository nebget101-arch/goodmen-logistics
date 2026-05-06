import { Component, OnDestroy, OnInit } from '@angular/core';
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
 * FN-1425: FleetNeuron-internal admin page for FMCSA reference data imports.
 * Lets internal operators trigger any subset of the five FMCSA importers, optionally
 * as a dry run, and watch the run ledger refresh live until every run leaves the
 * queued/running states.
 */
@Component({
  selector: 'app-fmcsa-imports-admin',
  templateUrl: './fmcsa-imports.component.html',
  styleUrls: ['./fmcsa-imports.component.css'],
})
export class FmcsaImportsAdminComponent implements OnInit, OnDestroy {
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

  private listSub: Subscription | null = null;
  private runSub: Subscription | null = null;
  private pollHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly service: FmcsaImportsService) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.cancelPoll();
    this.listSub?.unsubscribe();
    this.runSub?.unsubscribe();
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
}
