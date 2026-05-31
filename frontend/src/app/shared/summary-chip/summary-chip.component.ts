import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';

/**
 * Compact confirmation chip: a green tick/border, a bold title, and a single
 * ellipsised detail line. When `editable`, shows a pencil button that emits
 * `edit`. Declared + exported from `SharedModule`.
 */
@Component({
  selector: 'app-summary-chip',
  templateUrl: './summary-chip.component.html',
  styleUrls: ['./summary-chip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryChipComponent {
  @Input() title = '';
  @Input() detail = '';
  @Input() editable = false;

  @Output() edit = new EventEmitter<void>();

  onEdit(): void {
    this.edit.emit();
  }
}
