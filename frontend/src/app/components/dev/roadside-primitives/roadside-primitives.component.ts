import { ChangeDetectionStrategy, Component } from '@angular/core';
import { StepperStep } from '../../../shared/status-stepper/status-stepper.component';
import { RailTab } from '../../../shared/side-rail-tabs/side-rail-tabs.component';
import { ToastService } from '../../../shared/toast/toast.service';

/**
 * Dev-only sandbox demonstrating every FN-1644 Roadside primitive.
 * Reachable at `/dev/roadside-primitives` only when `!environment.production`.
 */
@Component({
  selector: 'app-roadside-primitives',
  templateUrl: './roadside-primitives.component.html',
  styleUrls: ['./roadside-primitives.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoadsidePrimitivesComponent {
  steps: StepperStep[] = [
    { key: 'dispatch', label: 'Dispatched', kicker: 'Step 1', status: 'complete' },
    { key: 'enroute', label: 'En route', kicker: 'Step 2', value: '12 min', status: 'current' },
    { key: 'onsite', label: 'On site', kicker: 'Step 3', status: 'pending' },
    { key: 'invoice', label: 'Invoice', kicker: 'Step 4', status: 'blocked' },
    { key: 'closed', label: 'Closed', kicker: 'Step 5', status: 'skipped' },
  ];
  activeKey = 'enroute';

  railTabs: RailTab[] = [
    { key: 'timeline', label: 'Timeline', icon: 'timeline' },
    { key: 'location', label: 'Location', icon: 'location_on' },
    { key: 'attachments', label: 'Attachments', icon: 'attach_file' },
    { key: 'public', label: 'Public Link', icon: 'link' },
  ];
  activeTab = 'timeline';

  constructor(private readonly toasts: ToastService) {}

  onStepChange(key: string): void {
    this.activeKey = key;
    this.toasts.info(`Step changed to "${key}"`);
  }

  onChipEdit(field: string): void {
    this.toasts.info(`Edit requested: ${field}`);
  }

  onReadFieldEdit(): void {
    this.toasts.success('Read-field edit clicked');
  }

  showSuccess(): void {
    this.toasts.success('Operation completed successfully');
  }

  showError(): void {
    this.toasts.error('Something went wrong');
  }

  showInfo(): void {
    this.toasts.info('Just so you know…');
  }
}
