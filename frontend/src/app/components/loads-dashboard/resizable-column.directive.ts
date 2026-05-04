import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
  SimpleChanges,
} from '@angular/core';

/**
 * FN-1059 — `appResizableColumn`
 *
 * Attaches a draggable + keyboard-accessible resize handle to the right edge
 * of any `<th>` so the user can resize a table column. Emits the new width
 * (in px, clamped to [minWidth, maxWidth]) on every drag move and on each
 * keyboard step. Persistence/debounce is the caller's responsibility — this
 * directive only owns the interaction.
 *
 * Usage:
 *   <th [appResizableColumn]="'pickup'"
 *       [currentWidth]="getColWidth('pickup')"
 *       (widthChange)="onColumnWidthChange('pickup', $event)">
 *     Pickup
 *   </th>
 *
 * Notes:
 * - The handle stops propagation on mousedown / click so the host `<th>`'s
 *   sort handler does not fire when the user grabs the divider (AC10).
 * - Keyboard a11y: handle is `tabindex=0`, `role="separator"` with
 *   `aria-orientation="vertical"`. ArrowLeft/Right step ±8px;
 *   Shift+Arrow step ±32px; both clamped to [minWidth, maxWidth].
 * - No third-party drag lib — Renderer2 + DOM events only.
 */
@Directive({ selector: '[appResizableColumn]' })
export class ResizableColumnDirective implements OnInit, OnChanges, OnDestroy {
  /** Column key — used for the handle's accessible name. */
  @Input('appResizableColumn') colKey = '';
  @Input() minWidth = 60;
  @Input() maxWidth = 600;
  /** Current width in px — bound from parent so keyboard steps and
   *  `aria-valuenow` stay accurate. */
  @Input() currentWidth = 0;
  @Input() stepSmall = 8;
  @Input() stepLarge = 32;

  @Output() widthChange = new EventEmitter<number>();

  private handleEl: HTMLElement | null = null;
  private handleListenerCleanups: Array<() => void> = [];
  private docListenerCleanups: Array<() => void> = [];
  private dragging = false;
  private startX = 0;
  private startWidth = 0;
  private restoreHostPosition: string | null = null;

  constructor(
    private host: ElementRef<HTMLElement>,
    private renderer: Renderer2,
  ) {}

  ngOnInit(): void {
    const hostEl = this.host.nativeElement;
    if (typeof window !== 'undefined') {
      const cs = window.getComputedStyle(hostEl);
      if (cs && cs.position === 'static') {
        this.restoreHostPosition = hostEl.style.position || '';
        this.renderer.setStyle(hostEl, 'position', 'relative');
      }
    }

    this.handleEl = this.renderer.createElement('span');
    this.renderer.addClass(this.handleEl, 'app-resize-handle');
    this.renderer.setAttribute(this.handleEl, 'role', 'separator');
    this.renderer.setAttribute(this.handleEl, 'aria-orientation', 'vertical');
    this.renderer.setAttribute(this.handleEl, 'tabindex', '0');
    this.renderer.setAttribute(
      this.handleEl,
      'aria-label',
      `Resize ${this.colKey || 'column'} column`,
    );
    this.applyAriaValues();
    this.renderer.appendChild(hostEl, this.handleEl);

    this.handleListenerCleanups.push(
      this.renderer.listen(this.handleEl, 'mousedown', this.onMouseDown),
      this.renderer.listen(this.handleEl, 'touchstart', this.onTouchStart),
      this.renderer.listen(this.handleEl, 'click', this.onHandleClick),
      this.renderer.listen(this.handleEl, 'keydown', this.onKeyDown),
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['currentWidth'] ||
      changes['minWidth'] ||
      changes['maxWidth']
    ) {
      this.applyAriaValues();
    }
  }

  ngOnDestroy(): void {
    this.cleanupDocListeners();
    this.handleListenerCleanups.forEach((fn) => fn());
    this.handleListenerCleanups = [];
    if (this.handleEl && this.handleEl.parentNode) {
      this.handleEl.parentNode.removeChild(this.handleEl);
    }
    this.handleEl = null;
    if (this.restoreHostPosition !== null) {
      this.renderer.setStyle(
        this.host.nativeElement,
        'position',
        this.restoreHostPosition,
      );
    }
  }

  private applyAriaValues(): void {
    if (!this.handleEl) return;
    this.renderer.setAttribute(this.handleEl, 'aria-valuemin', String(this.minWidth));
    this.renderer.setAttribute(this.handleEl, 'aria-valuemax', String(this.maxWidth));
    const v = Math.round(this.currentWidth || this.minWidth);
    this.renderer.setAttribute(this.handleEl, 'aria-valuenow', String(v));
  }

  private onMouseDown = (ev: MouseEvent): void => {
    // AC10: prevent <th> sort from firing when the user grabs the divider.
    ev.stopPropagation();
    ev.preventDefault();
    this.beginDrag(ev.clientX);
    this.docListenerCleanups.push(
      this.renderer.listen('document', 'mousemove', this.onMouseMove),
      this.renderer.listen('document', 'mouseup', this.onMouseUp),
    );
  };

  private onMouseMove = (ev: MouseEvent): void => {
    if (!this.dragging) return;
    this.applyDelta(ev.clientX - this.startX);
  };

  private onMouseUp = (): void => {
    this.endDrag();
  };

  private onTouchStart = (ev: TouchEvent): void => {
    if (!ev.touches || ev.touches.length === 0) return;
    ev.stopPropagation();
    this.beginDrag(ev.touches[0].clientX);
    this.docListenerCleanups.push(
      this.renderer.listen('document', 'touchmove', this.onTouchMove),
      this.renderer.listen('document', 'touchend', this.onTouchEnd),
      this.renderer.listen('document', 'touchcancel', this.onTouchEnd),
    );
  };

  private onTouchMove = (ev: TouchEvent): void => {
    if (!this.dragging || !ev.touches || ev.touches.length === 0) return;
    this.applyDelta(ev.touches[0].clientX - this.startX);
  };

  private onTouchEnd = (): void => {
    this.endDrag();
  };

  private onHandleClick = (ev: MouseEvent): void => {
    // Belt-and-braces — also block click bubbling so a fast tap doesn't sort.
    ev.stopPropagation();
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    ev.stopPropagation();
    const step = ev.shiftKey ? this.stepLarge : this.stepSmall;
    const dir = ev.key === 'ArrowRight' ? 1 : -1;
    const base = this.currentWidth || this.minWidth;
    const next = this.clamp(base + dir * step);
    this.currentWidth = next;
    this.applyAriaValues();
    this.widthChange.emit(next);
  };

  private beginDrag(clientX: number): void {
    this.dragging = true;
    this.startX = clientX;
    this.startWidth = this.currentWidth || this.minWidth;
    if (typeof document !== 'undefined') {
      document.body.classList.add('app-col-resizing');
    }
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.cleanupDocListeners();
    if (typeof document !== 'undefined') {
      document.body.classList.remove('app-col-resizing');
    }
  }

  private applyDelta(deltaPx: number): void {
    const next = this.clamp(this.startWidth + deltaPx);
    if (next === this.currentWidth) return;
    this.currentWidth = next;
    this.applyAriaValues();
    this.widthChange.emit(next);
  }

  private cleanupDocListeners(): void {
    this.docListenerCleanups.forEach((fn) => fn());
    this.docListenerCleanups = [];
  }

  private clamp(v: number): number {
    if (!isFinite(v)) return this.minWidth;
    return Math.max(this.minWidth, Math.min(this.maxWidth, Math.round(v)));
  }
}
