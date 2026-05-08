import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';

export interface ActivityDrawerLine {
  sku: string;
  name: string;
  qty: number;
  unitCost: number;
}

export interface ActivityDrawerTicket {
  id: string;
  ticketNumber: string;
  vendorName: string;
  referenceNumber: string;
  postedAt: string | null;
  postedByName: string;
  locationName: string;
  totalParts: number;
  totalCost: number;
  invoiceUrl: string | null;
  invoiceFileName: string | null;
  lines: ActivityDrawerLine[];
}

/**
 * FN-1494 — Side drawer rendering a single posted receiving ticket, opened
 * from the Activity tab table. Focus-trapped while open; Escape closes.
 * The parent owns ticket selection — passing `[ticket]=null` un-mounts the
 * drawer entirely (`*ngIf="ticket"` in the parent template).
 */
@Component({
  selector: 'app-receiving-activity-drawer',
  templateUrl: './receiving-activity-drawer.component.html',
  styleUrls: ['./receiving-activity-drawer.component.css'],
})
export class ReceivingActivityDrawerComponent implements AfterViewInit, OnDestroy {
  @Input() ticket: ActivityDrawerTicket | null = null;

  @Output() close = new EventEmitter<void>();

  @ViewChild('drawerPanel', { static: false }) drawerPanelRef?: ElementRef<HTMLElement>;

  private previouslyFocused: Element | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement;
    queueMicrotask(() => {
      const panel = this.drawerPanelRef?.nativeElement;
      const target = panel?.querySelector<HTMLElement>('[data-drawer-initial-focus]')
        ?? panel?.querySelector<HTMLElement>('button, [tabindex]:not([tabindex="-1"])')
        ?? panel ?? null;
      target?.focus();
    });
  }

  ngOnDestroy(): void {
    if (this.previouslyFocused instanceof HTMLElement) {
      this.previouslyFocused.focus();
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    event.preventDefault();
    this.close.emit();
  }

  @HostListener('document:keydown.tab', ['$event'])
  onTab(event: KeyboardEvent): void {
    const panel = this.drawerPanelRef?.nativeElement;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onCloseClick(): void {
    this.close.emit();
  }

  onScrimClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close.emit();
    }
  }

  trackLine = (i: number, line: ActivityDrawerLine): string =>
    `${line.sku}-${i}`;
}
