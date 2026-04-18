import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { ApiService } from '../../../../services/api.service';
import { PermissionHelperService } from '../../../../services/permission-helper.service';
import { PERMISSIONS } from '../../../../models/access-control.model';

@Component({
  selector: 'app-wo-notes-tab',
  templateUrl: './notes-tab.component.html',
  styleUrls: ['./notes-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WoNotesTabComponent {
  @Input() workOrder: any = {};
  @Input() workOrderId: string | null = null;
  @Input() documents: any[] = [];
  @Input() files: File[] = [];

  @Output() reloadWorkOrder = new EventEmitter<void>();

  showAudit = false;

  constructor(
    private apiService: ApiService,
    private permissions: PermissionHelperService
  ) {}

  canUploadWorkOrderDocument(): boolean {
    return this.permissions.hasPermission(PERMISSIONS.DOCUMENTS_UPLOAD);
  }

  onFileChange(event: any): void {
    this.files = Array.from(event.target.files);
  }

  uploadDocument(event: any): void {
    if (!this.canUploadWorkOrderDocument()) return;
    const file = event.target.files?.[0];
    if (!file || !this.workOrderId) return;
    this.apiService.uploadWorkOrderDocument(this.workOrderId, file).subscribe({
      next: () => this.reloadWorkOrder.emit()
    });
  }

  toggleAudit(): void {
    this.showAudit = !this.showAudit;
  }
}
