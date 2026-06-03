import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

interface TimelineStep {
  status: string;
  label: string;
  state: 'past' | 'current' | 'future';
}

@Component({
  selector: 'app-wo-status-timeline',
  templateUrl: './status-timeline.component.html',
  styleUrls: ['./status-timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoStatusTimelineComponent {
  @Input() currentStatus = 'DRAFT';

  private readonly mainFlow: Array<{ status: string; label: string }> = [
    { status: 'DRAFT', label: 'Draft' },
    { status: 'IN_PROGRESS', label: 'In Progress' },
    { status: 'COMPLETED', label: 'Completed' },
    { status: 'CLOSED', label: 'Closed' }
  ];

  get normalizedStatus(): string {
    return (this.currentStatus || 'DRAFT').toUpperCase();
  }

  get isWaitingParts(): boolean {
    return this.normalizedStatus === 'WAITING_PARTS';
  }

  get isCanceled(): boolean {
    return this.normalizedStatus === 'CANCELED';
  }

  get mainSteps(): TimelineStep[] {
    const current = this.normalizedStatus;
    const mainFlowStatuses = this.mainFlow.map(s => s.status);

    // For WAITING_PARTS, treat IN_PROGRESS as current equivalent
    const effectiveStatus = current === 'WAITING_PARTS' ? 'IN_PROGRESS' : current;
    const currentIndex = mainFlowStatuses.indexOf(effectiveStatus);

    // For CANCELED, mark everything up to where it was as past
    if (current === 'CANCELED') {
      return this.mainFlow.map((step, i) => ({
        ...step,
        state: 'future' as const
      }));
    }

    return this.mainFlow.map((step, i) => {
      if (currentIndex < 0) {
        return { ...step, state: 'future' as const };
      }
      if (i < currentIndex) {
        return { ...step, state: 'past' as const };
      }
      if (i === currentIndex) {
        return { ...step, state: 'current' as const };
      }
      return { ...step, state: 'future' as const };
    });
  }
}
