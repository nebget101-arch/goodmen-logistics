import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';

interface ValidationError {
  field: string;
  message: string;
}

@Component({
  selector: 'app-wo-workflow-buttons',
  templateUrl: './workflow-buttons.component.html',
  styleUrls: ['./workflow-buttons.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoWorkflowButtonsComponent {
  @Input() workOrder: any = {};
  @Output() statusChange = new EventEmitter<{ newStatus: string; cancelReason?: string }>();

  validationErrors: ValidationError[] = [];
  showCancelDialog = false;
  cancelReason = '';
  cancelReasonError = '';

  get currentStatus(): string {
    return (this.workOrder?.status || 'DRAFT').toUpperCase();
  }

  get isTerminal(): boolean {
    return this.currentStatus === 'CLOSED' || this.currentStatus === 'CANCELED';
  }

  get showStartWork(): boolean {
    return this.currentStatus === 'DRAFT';
  }

  get showWaitingParts(): boolean {
    return this.currentStatus === 'IN_PROGRESS';
  }

  get showMarkComplete(): boolean {
    return this.currentStatus === 'IN_PROGRESS';
  }

  get showResumeWork(): boolean {
    return this.currentStatus === 'WAITING_PARTS';
  }

  get showCloseWorkOrder(): boolean {
    return this.currentStatus === 'COMPLETED';
  }

  get showCancel(): boolean {
    return !this.isTerminal;
  }

  onStartWork(): void {
    this.validationErrors = [];
    const errors = this.validateDraftToInProgress();
    if (errors.length > 0) {
      this.validationErrors = errors;
      return;
    }
    this.statusChange.emit({ newStatus: 'IN_PROGRESS' });
  }

  onWaitingParts(): void {
    this.validationErrors = [];
    this.statusChange.emit({ newStatus: 'WAITING_PARTS' });
  }

  onMarkComplete(): void {
    this.validationErrors = [];
    const errors = this.validateInProgressToCompleted();
    if (errors.length > 0) {
      this.validationErrors = errors;
      return;
    }
    this.statusChange.emit({ newStatus: 'COMPLETED' });
  }

  onResumeWork(): void {
    this.validationErrors = [];
    this.statusChange.emit({ newStatus: 'IN_PROGRESS' });
  }

  onCloseWorkOrder(): void {
    this.validationErrors = [];
    this.statusChange.emit({ newStatus: 'CLOSED' });
  }

  openCancelDialog(): void {
    this.cancelReason = '';
    this.cancelReasonError = '';
    this.showCancelDialog = true;
  }

  closeCancelDialog(): void {
    this.showCancelDialog = false;
    this.cancelReason = '';
    this.cancelReasonError = '';
  }

  confirmCancel(): void {
    const reason = (this.cancelReason || '').trim();
    if (!reason) {
      this.cancelReasonError = 'A cancellation reason is required.';
      return;
    }
    this.validationErrors = [];
    this.statusChange.emit({ newStatus: 'CANCELED', cancelReason: reason });
    this.closeCancelDialog();
  }

  dismissErrors(): void {
    this.validationErrors = [];
  }

  private validateDraftToInProgress(): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!this.workOrder?.customerId) {
      errors.push({ field: 'customerId', message: 'A customer must be selected before starting work.' });
    }
    if (!this.workOrder?.vehicleId) {
      errors.push({ field: 'vehicleId', message: 'A vehicle must be selected before starting work.' });
    }
    if (!this.workOrder?.title?.trim()) {
      errors.push({ field: 'title', message: 'A work order title is required before starting work.' });
    }
    if (!this.workOrder?.type) {
      errors.push({ field: 'type', message: 'A work order type must be selected before starting work.' });
    }
    if (!this.workOrder?.priority) {
      errors.push({ field: 'priority', message: 'A priority must be set before starting work.' });
    }
    return errors;
  }

  private validateInProgressToCompleted(): ValidationError[] {
    const errors: ValidationError[] = [];
    const hasParts = Array.isArray(this.workOrder?.parts) && this.workOrder.parts.length > 0;
    const hasLabor = Array.isArray(this.workOrder?.labor) && this.workOrder.labor.length > 0;
    if (!hasParts && !hasLabor) {
      errors.push({ field: 'work', message: 'At least one part or labor line is required before marking complete.' });
    }
    return errors;
  }
}
