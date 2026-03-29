import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../services/api.service';

interface EquipmentOwner {
  id: string;
  type: string;
  display_type?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  fid_ein?: string | null;
  mc?: string | null;
  vendor_type?: string | null;
  is_additional_payee?: boolean;
  is_equipment_owner?: boolean;
  additional_payee_rate?: number | null;
  settlement_template_type?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

@Component({
  selector: 'app-equipment-owners',
  templateUrl: './equipment-owners.component.html',
  styleUrls: ['./equipment-owners.component.css']
})
export class EquipmentOwnersComponent implements OnInit {
  owners: EquipmentOwner[] = [];
  loading = false;
  saving = false;
  showModal = false;
  editingId: string | null = null;

  filters = {
    search: '',
    includeInactive: false
  };

  readonly settlementTemplateTypes = [
    { value: 'standard', label: 'Standard' },
    { value: 'owner_operator', label: 'Owner Operator' },
    { value: 'leased_owner', label: 'Leased Owner' }
  ];

  formData: Partial<EquipmentOwner> = this.getDefaultForm();

  constructor(
    private apiService: ApiService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadOwners();

    const queryParams = this.route.snapshot.queryParamMap;
    if (queryParams.get('create') === '1') {
      const prefillName = (queryParams.get('prefillName') || '').trim();
      this.openCreate(prefillName);
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { create: null, prefillName: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }

  getDefaultForm(): Partial<EquipmentOwner> {
    return {
      name: '',
      email: '',
      phone: '',
      address: '',
      address_line_2: '',
      city: '',
      state: '',
      zip: '',
      fid_ein: '',
      mc: '',
      vendor_type: 'equipment_rental',
      is_additional_payee: true,
      is_equipment_owner: true,
      additional_payee_rate: null,
      settlement_template_type: '',
      notes: '',
      is_active: true
    };
  }

  loadOwners(): void {
    this.loading = true;
    this.apiService.getAllPayees({
      type: 'equipment_owner',
      search: this.filters.search || undefined,
      is_active: this.filters.includeInactive ? undefined : true,
      limit: 500
    }).subscribe({
      next: (rows: EquipmentOwner[]) => {
        this.owners = Array.isArray(rows) ? rows : [];
        this.loading = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('Failed to load equipment owners', err);
        this.loading = false;
      }
    });
  }

  clearFilters(): void {
    this.filters = { search: '', includeInactive: false };
    this.loadOwners();
  }

  openCreate(prefillName: string = ''): void {
    this.editingId = null;
    this.formData = {
      ...this.getDefaultForm(),
      name: prefillName || ''
    };
    this.showModal = true;
  }

  openEdit(owner: EquipmentOwner): void {
    this.editingId = owner.id;
    this.formData = {
      ...this.getDefaultForm(),
      ...owner
    };
    this.showModal = true;
  }

  closeModal(): void {
    if (this.saving) return;
    this.showModal = false;
    this.editingId = null;
  }

  save(): void {
    const name = String(this.formData.name || '').trim();
    if (!name) {
      alert('Name is required');
      return;
    }

    this.saving = true;
    const payload: any = {
      type: 'equipment_owner',
      name,
      email: this.formData.email || null,
      phone: this.formData.phone || null,
      address: this.formData.address || null,
      address_line_2: this.formData.address_line_2 || null,
      city: this.formData.city || null,
      state: this.formData.state || null,
      zip: this.formData.zip || null,
      fid_ein: this.formData.fid_ein || null,
      mc: this.formData.mc || null,
      vendor_type: this.formData.vendor_type || null,
      notes: this.formData.notes || null,
      is_active: this.formData.is_active !== false,
      is_additional_payee: this.formData.is_additional_payee !== false,
      is_equipment_owner: this.formData.is_equipment_owner !== false,
      additional_payee_rate: this.formData.additional_payee_rate ?? null,
      settlement_template_type: this.formData.settlement_template_type || null
    };

    const req$ = this.editingId
      ? this.apiService.updatePayee(this.editingId, payload)
      : this.apiService.createPayee(payload);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.showModal = false;
        this.editingId = null;
        this.loadOwners();
      },
      error: (err: HttpErrorResponse) => {
        console.error('Failed to save equipment owner', err);
        alert(err?.error?.error || 'Failed to save equipment owner');
        this.saving = false;
      }
    });
  }

  toggleActive(owner: EquipmentOwner): void {
    this.apiService.updatePayee(owner.id, { is_active: !owner.is_active }).subscribe({
      next: () => {
        owner.is_active = !owner.is_active;
      },
      error: (err: HttpErrorResponse) => {
        console.error('Failed to update owner status', err);
        alert('Failed to update owner status');
      }
    });
  }

  deactivate(owner: EquipmentOwner): void {
    const ok = window.confirm(`Deactivate ${owner.name}? It will no longer appear in Additional Payee search.`);
    if (!ok) return;
    this.apiService.updatePayee(owner.id, { is_active: false }).subscribe({
      next: () => this.loadOwners(),
      error: (err: HttpErrorResponse) => {
        console.error('Failed to deactivate owner', err);
        alert('Failed to deactivate owner');
      }
    });
  }

  getOwnerLocation(owner: EquipmentOwner): string {
    const city = (owner?.city || '').trim();
    const state = (owner?.state || '').trim();
    return [city, state].filter((part) => !!part).join(', ') || '—';
  }
}
