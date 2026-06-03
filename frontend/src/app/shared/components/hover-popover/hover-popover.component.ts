import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostBinding,
  Input,
  NgZone,
  OnDestroy,
  TemplateRef,
  ViewChild
} from '@angular/core';
import {
  PreferredPlacement,
  Placement,
  calculatePopoverPosition
} from './hover-popover-position';

/**
 * FN-804 — reusable hover popover.
 *
 * Tooltip usage (text only):
 *   <app-hover-popover [text]="'Full note text here'">
 *     <span class="truncated">Truncated...</span>
 *   </app-hover-popover>
 *
 * Rich popover usage (template projection):
 *   <ng-template #brokerPreview>
 *     <div class="broker-card">...</div>
 *   </ng-template>
 *   <app-hover-popover [content]="brokerPreview">
 *     <span class="broker-name">{{ broker.name }}</span>
 *   </app-hover-popover>
 *
 * Inputs:
 *   - text: plain-text body (tooltip mode)
 *   - content: TemplateRef for rich content (overrides text when both set)
 *   - placement: 'auto' | 'top' | 'bottom' | 'left' | 'right' (default: 'auto')
 *   - showDelay: ms before fade-in (default: 100, per spec)
 *   - hideDelay: ms before hide after leave (default: 100)
 *   - disabled: suppresses the popover entirely
 */
@Component({
  selector: 'app-hover-popover',
  templateUrl: './hover-popover.component.html',
  styleUrls: ['./hover-popover.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HoverPopoverComponent implements OnDestroy {
  @Input() text: string | null = null;
  @Input() content: TemplateRef<unknown> | null = null;
  @Input() placement: PreferredPlacement = 'auto';
  @Input() showDelay = 100;
  @Input() hideDelay = 100;
  @Input() disabled = false;
  /** Optional max-width in px applied to the popover box. */
  @Input() maxWidth: number | null = 320;

  @ViewChild('popover') popoverRef?: ElementRef<HTMLElement>;
  @ViewChild('trigger', { static: true }) triggerRef!: ElementRef<HTMLElement>;

  @HostBinding('class.hp-host') hostClass = true;

  mounted = false;
  visible = false;
  top = 0;
  left = 0;
  resolvedPlacement: Placement = 'bottom';

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private rafHandle: number | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnDestroy(): void {
    this.clearTimers();
  }

  onTriggerEnter(): void {
    if (this.disabled || !this.hasBody()) return;
    this.cancelHide();
    if (this.mounted) return;
    this.showTimer = setTimeout(() => this.show(), Math.max(0, this.showDelay));
  }

  onTriggerLeave(): void {
    this.cancelShow();
    if (!this.mounted) return;
    this.hideTimer = setTimeout(() => this.hide(), Math.max(0, this.hideDelay));
  }

  onPopoverEnter(): void {
    this.cancelHide();
  }

  onPopoverLeave(): void {
    this.onTriggerLeave();
  }

  private show(): void {
    this.mounted = true;
    this.visible = false;
    this.cdr.markForCheck();
    // Wait for the popover element to render so we can measure it,
    // then reposition and fade in on the next animation frame.
    this.ngZone.runOutsideAngular(() => {
      this.rafHandle = requestAnimationFrame(() => {
        this.reposition();
        this.ngZone.run(() => {
          this.visible = true;
          this.cdr.markForCheck();
        });
      });
    });
  }

  private hide(): void {
    this.visible = false;
    this.mounted = false;
    this.cdr.markForCheck();
  }

  private reposition(): void {
    const popoverEl = this.popoverRef?.nativeElement;
    const triggerEl = this.triggerRef?.nativeElement;
    if (!popoverEl || !triggerEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const result = calculatePopoverPosition(
      {
        top: triggerRect.top,
        left: triggerRect.left,
        width: triggerRect.width,
        height: triggerRect.height
      },
      { width: popoverRect.width, height: popoverRect.height },
      { width: window.innerWidth, height: window.innerHeight },
      { preferredPlacement: this.placement }
    );

    this.ngZone.run(() => {
      this.top = result.top;
      this.left = result.left;
      this.resolvedPlacement = result.placement;
      this.cdr.markForCheck();
    });
  }

  private hasBody(): boolean {
    return !!this.content || !!(this.text && this.text.length);
  }

  private cancelShow(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private clearTimers(): void {
    this.cancelShow();
    this.cancelHide();
  }
}
