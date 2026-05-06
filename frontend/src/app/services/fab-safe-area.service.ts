import { Injectable } from '@angular/core';

/**
 * FN-1356: Registry for the `--neuron-fab-safe-bottom` CSS custom property.
 *
 * Any sticky bottom-right element registers a claim (in pixels). The largest
 * active claim wins and is applied to `document.documentElement` so the global
 * Ask Neuron FAB shifts up clear of the obstructing element. When a claim is
 * released the next-largest takes effect; with no claims the var is removed
 * (the FAB falls back to the default `0px`).
 */
@Injectable({ providedIn: 'root' })
export class FabSafeAreaService {
  static readonly CSS_VAR = '--neuron-fab-safe-bottom';

  private readonly claims = new Map<symbol, number>();

  register(pixels: number): symbol {
    const handle = Symbol('fab-safe-area-claim');
    this.claims.set(handle, Math.max(0, pixels));
    this.apply();
    return handle;
  }

  update(handle: symbol, pixels: number): void {
    if (!this.claims.has(handle)) return;
    this.claims.set(handle, Math.max(0, pixels));
    this.apply();
  }

  release(handle: symbol): void {
    if (!this.claims.delete(handle)) return;
    this.apply();
  }

  private apply(): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    if (this.claims.size === 0) {
      root.style.removeProperty(FabSafeAreaService.CSS_VAR);
      return;
    }
    const maxPx = Math.max(...this.claims.values());
    root.style.setProperty(FabSafeAreaService.CSS_VAR, `${maxPx}px`);
  }
}
