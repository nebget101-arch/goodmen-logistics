import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AgreementService } from '../agreement.service';
import { AgreementTemplate } from '../agreement.model';

/**
 * FN-1837 — agreement templates list (the `/agreements` landing view).
 *
 * Lists the tenant's uploaded agreement templates (name, type, pages, status,
 * created) via `GET /api/agreements/templates`, with an "Upload new agreement"
 * action that routes to the existing upload flow at `/agreements/new`. Rows are
 * clickable and route to the appropriate next step:
 *   - `draft`  → `…/review`    (review/finalize the AI-detected field map)
 *   - `ready`  → `…/placement` (open the visual field-placement editor)
 *
 * Loading / empty / error states are handled inline.
 */
@Component({
  selector: 'app-agreement-list',
  templateUrl: './agreement-list.component.html',
  styleUrls: ['./agreement-list.component.css'],
})
export class AgreementListComponent implements OnInit {
  templates: AgreementTemplate[] = [];
  loading = false;
  error = '';

  constructor(
    private agreements: AgreementService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.agreements.listTemplates().subscribe({
      next: (templates) => {
        this.templates = templates || [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to load agreement templates. Please try again.';
        this.loading = false;
      },
    });
  }

  uploadNew(): void {
    this.router.navigate(['/agreements', 'new']);
  }

  /** Open a template at the step that matches its lifecycle status. */
  open(template: AgreementTemplate): void {
    const next = template.status === 'ready' ? 'placement' : 'review';
    this.router.navigate(['/agreements', template.id, next]);
  }

  /** Humanize a snake_case document type (e.g. `lease_agreement` → `Lease Agreement`). */
  formatDocumentType(documentType: string): string {
    if (!documentType) return '—';
    return documentType
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  trackById(_index: number, template: AgreementTemplate): string {
    return template.id;
  }
}
