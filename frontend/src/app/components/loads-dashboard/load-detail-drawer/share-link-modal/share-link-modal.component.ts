import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { AiSelectOption } from '../../../../shared/ai-select/ai-select.component';
import {
  CreateShareLinkPayload,
  ShareLink,
  ShareLinkCreated,
  ShareLinkService,
  ShareRevealOptions,
} from '../../../../services/share-link.service';

type ModalView = 'loading' | 'create' | 'manage' | 'created';

/**
 * FN-1676 (Story E) — Share-tracking-link modal.
 *
 * Opened from the load detail drawer header. Lets a broker:
 *  - generate a public tracking link (expiry selector + reveal toggles),
 *  - copy the freshly-minted URL (shown once — token is never re-displayed),
 *  - see how many times an existing link has been viewed,
 *  - revoke an active link.
 *
 * Always-on reveal fields (location, ETA, timeline) are surfaced as static
 * chips; only the privacy-sensitive fields are toggleable. AI dark-theme
 * tokens only. The expiry dropdown uses `app-ai-select` with a stable options
 * array (never a getter) per FN-317.
 */
@Component({
  selector: 'app-share-link-modal',
  templateUrl: './share-link-modal.component.html',
  styleUrls: ['./share-link-modal.component.scss'],
})
export class ShareLinkModalComponent implements OnInit {
  /** Load whose tracking link is being managed. */
  @Input() loadId!: string;
  /** Human-readable load number for the modal header. */
  @Input() loadNumber = '';

  @Output() close = new EventEmitter<void>();

  view: ModalView = 'loading';
  loadingError = '';
  actionError = '';

  /** Existing links (metadata only). */
  links: ShareLink[] = [];
  /** The current active (non-revoked, non-expired) link, if any. */
  activeLink: ShareLink | null = null;
  /** The just-created link, carrying the one-time URL. */
  createdUrl = '';
  createdLink: ShareLinkCreated | null = null;

  /** Form state. */
  selectedExpiry = 7;
  revealOptions: ShareRevealOptions = this.defaultRevealOptions();

  busy = false;
  copyFeedback = '';
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stable options array (FN-317: never bind a getter to [options]). */
  readonly expiryOptions: AiSelectOption<number>[] = [
    { value: 7, label: '7 days after delivery' },
    { value: 14, label: '14 days after delivery' },
    { value: 30, label: '30 days after delivery' },
    { value: 0, label: 'No expiry' },
  ];

  /** Always-included fields the public page shows regardless of toggles. */
  readonly alwaysOnFields: { icon: string; label: string }[] = [
    { icon: 'my_location', label: 'Live location' },
    { icon: 'schedule', label: 'ETA' },
    { icon: 'timeline', label: 'Status timeline' },
  ];

  constructor(private shareLinkService: ShareLinkService) {}

  ngOnInit(): void {
    this.fetchLinks();
  }

  // ─── Data ────────────────────────────────────────────────────────────────

  private fetchLinks(): void {
    this.view = 'loading';
    this.loadingError = '';
    this.shareLinkService.list(this.loadId).subscribe({
      next: (res) => {
        this.links = res?.data || [];
        this.activeLink = this.links.find((l) => this.isActive(l)) || null;
        this.view = this.activeLink ? 'manage' : 'create';
      },
      error: () => {
        this.loadingError = 'Could not load existing share links.';
        this.view = 'create';
      },
    });
  }

  private isActive(link: ShareLink): boolean {
    if (link.revoked_at) return false;
    if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
      return false;
    }
    return true;
  }

  // ─── Reveal toggles ────────────────────────────────────────────────────────

  private defaultRevealOptions(): ShareRevealOptions {
    // Intake decision: driver + vehicle OFF by default. Breadcrumbs OFF
    // (granular GPS trail); route line ON (planned polyline, not sensitive).
    return {
      driverName: false,
      vehicleNumber: false,
      breadcrumbs: false,
      routeLine: true,
    };
  }

  toggleReveal(key: keyof ShareRevealOptions): void {
    this.revealOptions = {
      ...this.revealOptions,
      [key]: !this.revealOptions[key],
    };
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  generate(): void {
    if (this.busy) return;
    this.busy = true;
    this.actionError = '';
    const payload: CreateShareLinkPayload = {
      expiryDays: this.selectedExpiry === 0 ? null : this.selectedExpiry,
      revealOptions: this.revealOptions,
    };
    this.shareLinkService.create(this.loadId, payload).subscribe({
      next: (res) => {
        this.busy = false;
        const created = res?.data;
        if (!created) {
          this.actionError = 'Link created but no token was returned.';
          return;
        }
        this.createdLink = created;
        this.createdUrl = this.shareLinkService.buildShareUrl(created);
        this.activeLink = created;
        this.view = 'created';
      },
      error: (err) => {
        this.busy = false;
        this.actionError =
          err?.error?.error || err?.error?.message || 'Failed to create link.';
      },
    });
  }

  /** From the manage view, start a fresh create flow. */
  startNewLink(): void {
    this.revealOptions = this.defaultRevealOptions();
    this.selectedExpiry = 7;
    this.actionError = '';
    this.view = 'create';
  }

  // ─── Revoke ─────────────────────────────────────────────────────────────────

  revoke(): void {
    if (this.busy || !this.activeLink) return;
    // eslint-disable-next-line no-alert
    const ok = confirm(
      'Revoke this tracking link? Anyone holding the URL will lose access immediately.',
    );
    if (!ok) return;
    this.busy = true;
    this.actionError = '';
    const id = this.activeLink.id;
    this.shareLinkService.revoke(id).subscribe({
      next: () => {
        this.busy = false;
        this.links = this.links.map((l) =>
          l.id === id ? { ...l, revoked_at: new Date().toISOString() } : l,
        );
        this.activeLink = null;
        this.createdUrl = '';
        this.createdLink = null;
        this.startNewLink();
      },
      error: (err) => {
        this.busy = false;
        this.actionError =
          err?.error?.error || err?.error?.message || 'Failed to revoke link.';
      },
    });
  }

  // ─── Copy ─────────────────────────────────────────────────────────────────

  async copyUrl(): Promise<void> {
    if (!this.createdUrl) return;
    const ok = await this.copyToClipboard(this.createdUrl);
    this.setCopyFeedback(ok ? 'Copied to clipboard' : 'Copy failed — select and copy manually');
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', 'true');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        if (!copied) throw new Error('execCommand copy failed');
      }
      return true;
    } catch {
      return false;
    }
  }

  private setCopyFeedback(msg: string): void {
    this.copyFeedback = msg;
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => (this.copyFeedback = ''), 2500);
  }

  // ─── Close ──────────────────────────────────────────────────────────────────

  @HostListener('document:keydown.escape')
  requestClose(): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.close.emit();
  }

  /** Backdrop click closes; clicks inside the dialog are stopped in template. */
  onBackdropClick(): void {
    this.requestClose();
  }

  // ─── View helpers ─────────────────────────────────────────────────────────

  formatDate(value: string | null): string {
    if (!value) return 'Never';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  revealSummary(link: ShareLink): string {
    const o = link.reveal_options || ({} as ShareRevealOptions);
    const on: string[] = [];
    if (o.driverName) on.push('driver');
    if (o.vehicleNumber) on.push('vehicle');
    if (o.breadcrumbs) on.push('breadcrumbs');
    if (o.routeLine) on.push('route');
    return on.length ? on.join(', ') : 'location, ETA & timeline only';
  }
}
