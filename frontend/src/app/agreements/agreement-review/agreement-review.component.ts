import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgreementService } from '../agreement.service';
import {
  AgreementField,
  AgreementFieldRole,
  AgreementTemplate,
  AgreementFieldPatch,
  toggleRole,
  isLowConfidence,
  countLowConfidence,
  roleLabel,
  LOW_CONFIDENCE_THRESHOLD,
} from '../agreement.model';

/**
 * FN-1794 — AI field-mapping / role-assignment review screen.
 *
 * Lists every AI-detected field with its label, type, page, AI-suggested role
 * and confidence. The reviewer flips each field's role (internal ↔ signer);
 * low-confidence fields are visually flagged for review. Save finalizes the
 * template (PATCH .../fields, status = ready).
 */
@Component({
  selector: 'app-agreement-review',
  templateUrl: './agreement-review.component.html',
  styleUrls: ['./agreement-review.component.css'],
})
export class AgreementReviewComponent implements OnInit {
  templateId = '';
  template: AgreementTemplate | null = null;
  fields: AgreementField[] = [];

  loading = false;
  saving = false;
  loadError = '';
  saveError = '';

  readonly roleLabel = roleLabel;
  readonly lowConfidenceThreshold = LOW_CONFIDENCE_THRESHOLD;

  constructor(
    private agreements: AgreementService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.templateId = this.route.snapshot.paramMap.get('id') || '';
    if (this.templateId) this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.agreements.getTemplate(this.templateId).subscribe({
      next: (res) => {
        this.template = res;
        // Sort by detected order so the review list matches the document.
        this.fields = (res.fields || [])
          .slice()
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        this.loading = false;
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'Could not load the field map.';
        this.loading = false;
      },
    });
  }

  // ── Role toggle ───────────────────────────────────────────────────────────
  /** Flip a single field between internal and signer. */
  toggleFieldRole(field: AgreementField): void {
    field.role = toggleRole(field.role);
  }

  /** Set a field's role explicitly (used by the segmented control). */
  setFieldRole(field: AgreementField, role: AgreementFieldRole): void {
    field.role = role;
  }

  // ── Low-confidence flagging ───────────────────────────────────────────────
  isLowConfidence(field: AgreementField): boolean {
    return isLowConfidence(field);
  }

  get lowConfidenceCount(): number {
    return countLowConfidence(this.fields);
  }

  /** Confidence as a whole percentage for display. */
  confidencePercent(field: AgreementField): number {
    const c = field.confidence;
    return c == null || !Number.isFinite(c) ? 0 : Math.round(c * 100);
  }

  /** Whether the reviewer changed a field away from the AI suggestion. */
  isRoleOverridden(field: AgreementField): boolean {
    return field.role !== field.suggestedRole;
  }

  // ── Save / finalize ───────────────────────────────────────────────────────
  save(finalize: boolean): void {
    if (this.saving) return;
    this.saving = true;
    this.saveError = '';
    const patch: AgreementFieldPatch[] = this.fields.map((f) => ({
      id: f.id,
      role: f.role,
      label: f.label,
    }));
    this.agreements.saveFields(this.templateId, patch, finalize).subscribe({
      next: (res) => {
        this.saving = false;
        this.template = res;
        this.fields = (res.fields || [])
          .slice()
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        if (finalize) {
          this.router.navigate(['/agreements']);
        }
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Save failed. Please try again.';
      },
    });
  }

  /** Material icon for a field type. */
  typeIcon(type: AgreementField['fieldType']): string {
    switch (type) {
      case 'date': return 'calendar_today';
      case 'number': return 'tag';
      case 'checkbox': return 'check_box';
      case 'signature': return 'draw';
      case 'initials': return 'edit';
      case 'text':
      default: return 'text_fields';
    }
  }

  trackByField(_index: number, field: AgreementField): string {
    return field.id || field.fieldKey;
  }
}
