import {
  ChangeDetectionStrategy,
  Component,
  Input,
} from '@angular/core';

/**
 * FN-1353 — Driver chip.
 *
 * Renders the driver's initials in a token-colored circle alongside their
 * full name. When `name` is empty / null, renders an em-dash with a default
 * truck icon — keeping row alignment consistent.
 */
@Component({
  selector: 'app-driver-chip',
  templateUrl: './driver-chip.component.html',
  styleUrls: ['./driver-chip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DriverChipComponent {
  @Input() name: string | null | undefined = null;

  get hasName(): boolean {
    return !!(this.name && this.name.trim());
  }

  get initials(): string {
    const raw = (this.name || '').trim();
    if (!raw) return '';
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }
}
