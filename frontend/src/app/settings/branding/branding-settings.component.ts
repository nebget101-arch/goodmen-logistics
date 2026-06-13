import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../services/api.service';

type BrandingKind = 'operating-entity' | 'location';

/** Client-side upload constraints — mirror of the FN-1737 backend validation. */
const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const ACCEPTED_HINT = 'PNG, JPEG or WebP, up to 2MB';

/**
 * One manageable logo target (an MC/operating entity or a shop location).
 * Carries its own async + error state so each row uploads/deletes independently.
 */
interface BrandingRow {
  id: string;
  kind: BrandingKind;
  title: string;
  subtitle: string;
  logoUrl: string | null;
  mimeType: string | null;
  uploadedAt: string | null;
  loading: boolean;   // logo fetch / upload / delete in flight
  error: string | null;
  dragOver: boolean;
}

@Component({
  selector: 'app-branding-settings',
  templateUrl: './branding-settings.component.html',
  styleUrls: ['./branding-settings.component.scss']
})
export class BrandingSettingsComponent implements OnInit {
  readonly acceptedHint = ACCEPTED_HINT;
  readonly acceptAttr = ACCEPTED_MIME_TYPES.join(',');

  entityRows: BrandingRow[] = [];
  locationRows: BrandingRow[] = [];

  loadingEntities = false;
  loadingLocations = false;
  entitiesError: string | null = null;
  locationsError: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadEntities();
    this.loadLocations();
  }

  // ----- list loading ---------------------------------------------------

  loadEntities(): void {
    this.loadingEntities = true;
    this.entitiesError = null;
    this.api.listOperatingEntities().subscribe({
      next: (res: any) => {
        const data: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.entityRows = data.map((e) => this.makeRow(
          e.id,
          'operating-entity',
          e.dba_name || e.legal_name || e.name || 'Unnamed carrier',
          this.entitySubtitle(e)
        ));
        this.loadingEntities = false;
        this.entityRows.forEach((r) => this.refreshLogo(r));
      },
      error: (err) => {
        this.entitiesError = err?.error?.error || 'Failed to load carriers';
        this.loadingEntities = false;
      }
    });
  }

  loadLocations(): void {
    this.loadingLocations = true;
    this.locationsError = null;
    this.api.getLocations().subscribe({
      next: (res: any) => {
        const data: any[] = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        this.locationRows = data.map((l) => this.makeRow(
          l.id,
          'location',
          l.name || 'Unnamed location',
          this.locationSubtitle(l)
        ));
        this.loadingLocations = false;
        this.locationRows.forEach((r) => this.refreshLogo(r));
      },
      error: (err) => {
        this.locationsError = err?.error?.error || 'Failed to load shop locations';
        this.loadingLocations = false;
      }
    });
  }

  // ----- per-row logo lifecycle ----------------------------------------

  /** (Re)fetch the current logo state from the GET endpoint and update the preview. */
  refreshLogo(row: BrandingRow): void {
    row.loading = true;
    this.logoGet(row).subscribe({
      next: (res: any) => {
        row.logoUrl = res?.logoUrl ?? null;
        row.mimeType = res?.mimeType ?? null;
        row.uploadedAt = res?.uploadedAt ?? null;
        row.loading = false;
      },
      error: () => {
        // Missing/zero logo is a normal empty state, not a hard error.
        row.logoUrl = null;
        row.mimeType = null;
        row.uploadedAt = null;
        row.loading = false;
      }
    });
  }

  onFileSelected(row: BrandingRow, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (file) {
      this.uploadFile(row, file);
    }
    // Allow re-selecting the same file after a rejected attempt.
    input.value = '';
  }

  onDrop(row: BrandingRow, event: DragEvent): void {
    event.preventDefault();
    row.dragOver = false;
    if (row.loading) return;
    const file = event.dataTransfer?.files && event.dataTransfer.files[0];
    if (file) {
      this.uploadFile(row, file);
    }
  }

  onDragOver(row: BrandingRow, event: DragEvent): void {
    event.preventDefault();
    if (!row.loading) row.dragOver = true;
  }

  onDragLeave(row: BrandingRow, event: DragEvent): void {
    event.preventDefault();
    row.dragOver = false;
  }

  removeLogo(row: BrandingRow): void {
    if (row.loading) return;
    const confirmed = window.confirm(`Remove the logo for "${row.title}"?`);
    if (!confirmed) return;

    row.loading = true;
    row.error = null;
    this.logoDelete(row).subscribe({
      next: () => {
        // Refresh from GET to confirm the cleared state.
        this.refreshLogo(row);
      },
      error: (err) => {
        row.error = err?.error?.error || 'Failed to remove logo';
        row.loading = false;
      }
    });
  }

  // ----- internals ------------------------------------------------------

  private uploadFile(row: BrandingRow, file: File): void {
    const validationError = this.validateFile(file);
    if (validationError) {
      row.error = validationError;
      return;
    }

    row.loading = true;
    row.error = null;
    this.logoUpload(row, file).subscribe({
      next: () => {
        // Per the contract POST returns the new logo, but we refresh from GET
        // so the preview reflects the canonical signed URL.
        this.refreshLogo(row);
      },
      error: (err) => {
        row.error = err?.error?.error || 'Upload failed. Please try again.';
        row.loading = false;
      }
    });
  }

  private validateFile(file: File): string | null {
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      return `Unsupported file type. Use ${ACCEPTED_HINT}.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `File is too large. Maximum size is 2MB.`;
    }
    return null;
  }

  private makeRow(id: string, kind: BrandingKind, title: string, subtitle: string): BrandingRow {
    return {
      id,
      kind,
      title,
      subtitle,
      logoUrl: null,
      mimeType: null,
      uploadedAt: null,
      loading: false,
      error: null,
      dragOver: false
    };
  }

  private entitySubtitle(e: any): string {
    const parts: string[] = [];
    if (e.mc_number) parts.push(`MC ${e.mc_number}`);
    if (e.dot_number) parts.push(`DOT ${e.dot_number}`);
    return parts.join(' · ');
  }

  private locationSubtitle(l: any): string {
    const cityState = [l.city, l.state].filter(Boolean).join(', ');
    return [l.code, cityState].filter(Boolean).join(' · ');
  }

  private logoGet(row: BrandingRow): Observable<any> {
    return row.kind === 'operating-entity'
      ? this.api.getOperatingEntityLogo(row.id)
      : this.api.getLocationLogo(row.id);
  }

  private logoUpload(row: BrandingRow, file: File): Observable<any> {
    return row.kind === 'operating-entity'
      ? this.api.uploadOperatingEntityLogo(row.id, file)
      : this.api.uploadLocationLogo(row.id, file);
  }

  private logoDelete(row: BrandingRow): Observable<any> {
    return row.kind === 'operating-entity'
      ? this.api.deleteOperatingEntityLogo(row.id)
      : this.api.deleteLocationLogo(row.id);
  }

  trackById(_index: number, row: BrandingRow): string {
    return row.id;
  }
}
