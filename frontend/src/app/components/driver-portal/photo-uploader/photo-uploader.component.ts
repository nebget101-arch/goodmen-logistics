import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { ApiService } from '../../../services/api.service';

@Component({
  selector: 'app-photo-uploader',
  template: `
    <div class="photo-uploader" [class.unavailable]="!available">
      <div *ngIf="!available" class="uploader-placeholder" role="note" aria-label="Photo upload not yet available">
        <span class="material-icons placeholder-icon" aria-hidden="true">photo_camera_off</span>
        <p class="placeholder-msg">Photo upload will be available once image storage is configured.</p>
      </div>

      <div *ngIf="available" class="uploader-active">
        <label
          class="upload-trigger"
          [class.busy]="uploading"
          [attr.aria-disabled]="uploading ? 'true' : null"
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic"
            (change)="onFileSelected($event)"
            [disabled]="uploading"
            class="visually-hidden"
            aria-label="Add photo"
          />
          <span class="material-icons trigger-icon" aria-hidden="true">
            {{ uploading ? 'hourglass_empty' : 'add_a_photo' }}
          </span>
          <span class="trigger-label">{{ uploading ? 'Uploading…' : 'Add Photo' }}</span>
        </label>

        <div *ngIf="error" class="upload-error" role="alert">
          <span class="material-icons" aria-hidden="true">error_outline</span>
          {{ error }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .photo-uploader { display: contents; }

    .uploader-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 20px;
      border-radius: 10px;
      border: 1px dashed rgba(148, 163, 184, 0.3);
      color: #64748b;
      text-align: center;
    }
    .placeholder-icon { font-size: 28px; color: #475569; }
    .placeholder-msg { margin: 0; font-size: 13px; }

    .upload-trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 18px;
      border-radius: 8px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .upload-trigger:not(.busy):hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: rgba(56, 189, 248, 0.6);
    }
    .upload-trigger.busy { opacity: 0.65; cursor: not-allowed; }
    .trigger-icon { font-size: 18px; }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .upload-error {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      color: #fca5a5;
      font-size: 13px;
    }
    .upload-error .material-icons { font-size: 16px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoUploaderComponent {
  @Input() incidentId = '';
  @Input() available = false;
  @Output() uploaded = new EventEmitter<void>();

  uploading = false;
  error = '';

  constructor(private apiService: ApiService, private cdr: ChangeDetectorRef) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file || !this.incidentId) return;

    if (file.size > 10 * 1024 * 1024) {
      this.error = 'File exceeds the 10 MB limit. Please choose a smaller image.';
      this.cdr.markForCheck();
      input.value = '';
      return;
    }

    this.uploading = true;
    this.error = '';
    this.cdr.markForCheck();

    this.apiService.uploadIncidentImage(this.incidentId, file).subscribe({
      next: () => {
        this.uploading = false;
        this.uploaded.emit();
        this.cdr.markForCheck();
        input.value = '';
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Upload failed. Please try again.';
        this.uploading = false;
        this.cdr.markForCheck();
        input.value = '';
      },
    });
  }
}
