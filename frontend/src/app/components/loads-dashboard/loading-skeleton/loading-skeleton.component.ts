import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface SkeletonColumn {
  key: string;
  width: string;
  visible: boolean;
}

/**
 * FN-821: Shimmer skeleton rows for the loads table.
 *
 * Replaces the "Loading loads…" spinner during page load, filter apply,
 * and smart-filter apply. Renders a colgroup that matches the real
 * table's column widths so the layout doesn't reflow when data arrives.
 *
 * Shimmer animation uses `@keyframes` + `background-position` on a
 * gradient background — compositor-only so it stays at 60fps. The
 * `@media (prefers-reduced-motion)` block freezes the animation at its
 * neutral position and keeps the placeholder visible as a flat surface.
 */
@Component({
  selector: 'app-loads-loading-skeleton',
  templateUrl: './loading-skeleton.component.html',
  styleUrls: ['./loading-skeleton.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadsLoadingSkeletonComponent {
  /** Column metadata from the parent; width strings mirror the real colgroup. */
  @Input() columns: SkeletonColumn[] = [];
  /** True when the row should include the select checkbox column (non-driver users). */
  @Input() showSelect = true;
  /** Number of skeleton rows to render. Default 10 covers most viewport heights. */
  @Input() rowCount = 10;

  get rows(): number[] {
    // Stable array identity per rowCount — avoids re-creating on every CD.
    return Array.from({ length: this.rowCount }, (_, i) => i);
  }

  trackByIndex(_: number, idx: number): number {
    return idx;
  }
}
