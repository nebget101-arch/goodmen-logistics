import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';

/**
 * FN-1353 — Actions menu.
 *
 * Primary "Open" button + ⋯ overflow with: Edit, Clone, View on map,
 * Track driver, Copy link. The overflow menu closes on outside click and
 * Escape. The component is purely presentational — the parent decides what
 * each emitted event does.
 */
@Component({
  selector: 'app-actions-menu',
  templateUrl: './actions-menu.component.html',
  styleUrls: ['./actions-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionsMenuComponent {
  @Input() loadId = '';

  @Output() open       = new EventEmitter<string>();
  @Output() edit       = new EventEmitter<string>();
  @Output() clone      = new EventEmitter<string>();
  @Output() viewOnMap  = new EventEmitter<string>();
  @Output() trackDriver = new EventEmitter<string>();
  @Output() copyLink   = new EventEmitter<string>();

  /** True when the overflow menu is open. */
  menuOpen = false;

  constructor(private host: ElementRef<HTMLElement>) {}

  toggleMenu(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  // ─── Outside click & Escape ──────────────────────────────────────────────

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.menuOpen = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen) {
      this.menuOpen = false;
    }
  }

  // ─── Primary + overflow actions ──────────────────────────────────────────

  emitOpen(event: Event): void {
    event.stopPropagation();
    this.open.emit(this.loadId);
  }

  emitEdit(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.edit.emit(this.loadId);
  }

  emitClone(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.clone.emit(this.loadId);
  }

  emitViewOnMap(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.viewOnMap.emit(this.loadId);
  }

  emitTrackDriver(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.trackDriver.emit(this.loadId);
  }

  emitCopyLink(event: Event): void {
    event.stopPropagation();
    this.menuOpen = false;
    this.copyLink.emit(this.loadId);
  }
}
