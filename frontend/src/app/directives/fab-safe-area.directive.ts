import { Directive, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { FabSafeAreaService } from '../services/fab-safe-area.service';

/**
 * FN-1356: Attribute directive that registers a "safe bottom" claim with
 * `FabSafeAreaService`. While the host element is mounted, the largest active
 * claim is published as `--neuron-fab-safe-bottom` on the document root so the
 * Ask Neuron FAB shifts up clear of the host.
 *
 *   <div class="pagination" appFabSafeArea="64">…</div>
 *
 * Default value is 64px (covers the loads paginator + drawer footer heights).
 */
@Directive({
  selector: '[appFabSafeArea]',
  standalone: true,
})
export class FabSafeAreaDirective implements OnInit, OnChanges, OnDestroy {
  @Input('appFabSafeArea') value: number | string | null | undefined = 64;

  private handle: symbol | null = null;

  constructor(private readonly safeArea: FabSafeAreaService) {}

  ngOnInit(): void {
    this.handle = this.safeArea.register(this.parsePixels());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.handle) {
      this.safeArea.update(this.handle, this.parsePixels());
    }
  }

  ngOnDestroy(): void {
    if (this.handle) {
      this.safeArea.release(this.handle);
      this.handle = null;
    }
  }

  private parsePixels(): number {
    const raw = this.value;
    if (raw == null || raw === '') return 64;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 64;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 64;
  }
}
