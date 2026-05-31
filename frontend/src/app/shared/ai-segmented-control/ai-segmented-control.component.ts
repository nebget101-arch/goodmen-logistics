import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/** One selectable segment. */
export interface AiSegment {
  key: string;
  label: string;
}

/**
 * FN-1636 — generic segmented button group. Used for the dashboard
 * timeframe (Today / 7D / 30D / Custom) and reusable on other pages.
 *
 * Active segment uses the flat `.btn-primary` gradient (no glow);
 * inactive segments use `.btn-secondary`. Each button exposes
 * `aria-pressed` and the container is a `role="group"`.
 */
@Component({
  selector: 'app-ai-segmented-control',
  templateUrl: './ai-segmented-control.component.html',
  styleUrls: ['./ai-segmented-control.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiSegmentedControlComponent {
  /** Segments to render, left to right. */
  @Input() segments: AiSegment[] = [];

  /** Currently selected segment key. */
  @Input() selectedKey: string | null = null;

  /** Accessible group label. */
  @Input() ariaLabel = 'Segmented control';

  /** Two-way bindable selection: `[(selectedKey)]`. */
  @Output() selectedKeyChange = new EventEmitter<string>();

  isSelected(key: string): boolean {
    return this.selectedKey === key;
  }

  select(key: string): void {
    if (key === this.selectedKey) {
      return;
    }
    this.selectedKey = key;
    this.selectedKeyChange.emit(key);
  }

  trackByKey(_index: number, seg: AiSegment): string {
    return seg.key;
  }
}
