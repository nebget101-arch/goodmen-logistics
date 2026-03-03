import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-attachment-chip',
  templateUrl: './attachment-chip.component.html',
  styleUrls: ['./attachment-chip.component.scss']
})
export class AttachmentChipComponent {
  @Input() type: string | null = '';

  get label(): string {
    const value = (this.type || '').toString().toUpperCase();
    switch (value) {
      case 'RATE_CONFIRMATION':
        return 'Conf';
      case 'BOL':
        return 'BOL';
      case 'LUMPER':
        return 'Lumper';
      case 'CONFIRMATION':
        return 'Confirm';
      case 'OTHER':
        return 'Other';
      default:
        return 'Doc';
    }
  }

  get cssClass(): string {
    const value = (this.type || '').toString().toUpperCase();
    switch (value) {
      case 'RATE_CONFIRMATION':
        return 'chip-blue';
      case 'BOL':
        return 'chip-green';
      case 'LUMPER':
        return 'chip-orange';
      case 'CONFIRMATION':
        return 'chip-purple';
      default:
        return 'chip-gray';
    }
  }
}
