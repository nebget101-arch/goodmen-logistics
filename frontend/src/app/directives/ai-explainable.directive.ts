import {
  Directive,
  ElementRef,
  HostBinding,
  HostListener,
  Input,
  OnChanges,
  Renderer2,
  SimpleChanges,
} from '@angular/core';
import { ExplainService } from '../services/explain.service';

/**
 * Attribute directive: `[appAiExplainable]="token"`.
 *
 * Marks any element as the trigger for the global explain panel. When the user
 * clicks (or activates via keyboard) the host, the panel slides in and fetches
 * `GET /api/ai/explain/:token`.
 *
 *   <span [appAiExplainable]="claim.explainabilityToken"
 *         appAiExplainableLabel="Driver risk score">
 *     {{ claim.value }}
 *   </span>
 *
 * Visual: dotted underline + help cursor, so users learn AI values are inspectable.
 * a11y: host gets role="button" / tabindex="0" / aria-label so screen readers and
 * keyboard users can open the panel.
 */
@Directive({
  selector: '[appAiExplainable]',
  standalone: true,
})
export class AiExplainableDirective implements OnChanges {
  /** The explainability token returned by the AI service alongside the value. */
  @Input('appAiExplainable') token: string | null | undefined;

  /** Optional human label shown in the panel header (e.g. "Driver risk score"). */
  @Input() appAiExplainableLabel: string | null | undefined;

  @HostBinding('class.ai-explainable') readonly hostClass = true;
  @HostBinding('class.ai-explainable--inactive')
  get inactive(): boolean { return !this.token; }

  constructor(
    private readonly explain: ExplainService,
    private readonly el: ElementRef<HTMLElement>,
    private readonly renderer: Renderer2,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['token'] || changes['appAiExplainableLabel']) {
      this.applyA11y();
    }
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (!this.token) return;
    event.stopPropagation();
    this.explain.open(this.token, this.appAiExplainableLabel ?? undefined);
  }

  @HostListener('keydown.enter', ['$event'])
  @HostListener('keydown.space', ['$event'])
  onKeyActivate(event: KeyboardEvent): void {
    if (!this.token) return;
    event.preventDefault();
    event.stopPropagation();
    this.explain.open(this.token, this.appAiExplainableLabel ?? undefined);
  }

  private applyA11y(): void {
    const host = this.el.nativeElement;
    if (this.token) {
      this.renderer.setAttribute(host, 'role', 'button');
      this.renderer.setAttribute(host, 'tabindex', '0');
      const label = this.appAiExplainableLabel
        ? `Explain ${this.appAiExplainableLabel}`
        : 'Explain this AI value';
      this.renderer.setAttribute(host, 'aria-label', label);
    } else {
      this.renderer.removeAttribute(host, 'role');
      this.renderer.removeAttribute(host, 'tabindex');
      this.renderer.removeAttribute(host, 'aria-label');
    }
  }
}
