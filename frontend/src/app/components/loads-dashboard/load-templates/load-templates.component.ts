import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  LoadTemplatesService,
  LoadTemplateListItem
} from '../../../services/load-templates.service';

interface EditingTemplate {
  id: string;
  name: string;
  description: string;
}

@Component({
  selector: 'app-load-templates',
  templateUrl: './load-templates.component.html',
  styleUrls: ['./load-templates.component.scss']
})
export class LoadTemplatesComponent implements OnInit {
  templates: LoadTemplateListItem[] = [];
  loading = true;
  errorMessage = '';
  successMessage = '';

  editing: EditingTemplate | null = null;
  savingEdit = false;

  deletingId: string | null = null;
  confirmDeleteId: string | null = null;
  usingId: string | null = null;

  constructor(
    private service: LoadTemplatesService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadTemplates();
  }

  loadTemplates(): void {
    this.loading = true;
    this.errorMessage = '';
    this.service.list().subscribe({
      next: (res) => {
        this.templates = Array.isArray(res?.data) ? res.data : [];
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load templates.';
        this.loading = false;
      }
    });
  }

  /** "Last pickup city → last delivery city" summary for the route column. */
  routeLabel(t: LoadTemplateListItem): string {
    const origin = [t.first_pickup_city, t.first_pickup_state].filter(Boolean).join(', ');
    const destination = [t.last_delivery_city, t.last_delivery_state].filter(Boolean).join(', ');
    if (origin && destination) return `${origin} → ${destination}`;
    return origin || destination || '—';
  }

  formatLastUsed(value: string | null): string {
    if (!value) return 'Never';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Never';
    return d.toLocaleDateString();
  }

  backToLoads(): void {
    this.router.navigate(['/loads']);
  }

  use(template: LoadTemplateListItem): void {
    if (this.usingId) return;
    this.usingId = template.id;
    this.errorMessage = '';
    this.service.get(template.id).subscribe({
      next: (res) => {
        const detail = res?.data;
        if (!detail) {
          this.usingId = null;
          this.errorMessage = 'Template data is unavailable.';
          return;
        }
        this.service.markUsed(template.id).subscribe({ error: () => {} });
        this.router.navigate(['/loads'], {
          state: { useTemplate: { id: detail.id, name: detail.name, data: detail.template_data } }
        });
      },
      error: () => {
        this.usingId = null;
        this.errorMessage = 'Failed to open template.';
      }
    });
  }

  openEdit(template: LoadTemplateListItem): void {
    this.editing = {
      id: template.id,
      name: template.name || '',
      description: template.description || ''
    };
  }

  cancelEdit(): void {
    this.editing = null;
  }

  saveEdit(): void {
    if (!this.editing) return;
    const name = (this.editing.name || '').trim();
    if (!name) {
      this.errorMessage = 'Name is required.';
      return;
    }
    this.savingEdit = true;
    this.errorMessage = '';
    this.service.update(this.editing.id, {
      name,
      description: (this.editing.description || '').trim() || null
    }).subscribe({
      next: (res) => {
        const updated = res?.data;
        this.templates = this.templates.map((t) =>
          t.id === updated.id ? { ...t, name: updated.name, description: updated.description } : t
        );
        this.successMessage = 'Template updated.';
        this.savingEdit = false;
        this.editing = null;
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: () => {
        this.errorMessage = 'Failed to update template.';
        this.savingEdit = false;
      }
    });
  }

  confirmDelete(template: LoadTemplateListItem): void {
    this.confirmDeleteId = template.id;
  }

  cancelDelete(): void {
    this.confirmDeleteId = null;
  }

  doDelete(): void {
    if (!this.confirmDeleteId) return;
    const id = this.confirmDeleteId;
    this.deletingId = id;
    this.errorMessage = '';
    this.service.delete(id).subscribe({
      next: () => {
        this.templates = this.templates.filter((t) => t.id !== id);
        this.deletingId = null;
        this.confirmDeleteId = null;
        this.successMessage = 'Template deleted.';
        setTimeout(() => (this.successMessage = ''), 3000);
      },
      error: () => {
        this.deletingId = null;
        this.confirmDeleteId = null;
        this.errorMessage = 'Failed to delete template.';
      }
    });
  }

  trackById(_index: number, item: LoadTemplateListItem): string {
    return item.id;
  }
}
