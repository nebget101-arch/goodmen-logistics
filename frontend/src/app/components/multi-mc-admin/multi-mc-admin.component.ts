import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';

interface OperatingEntityRow {
  id: string;
  name: string;
  legal_name?: string | null;
  dba_name?: string | null;
  mc_number?: string | null;
  dot_number?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  entity_type?: string | null;
  is_active?: boolean;
}

interface UserRow {
  id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  role?: string | null;
}

@Component({
  selector: 'app-multi-mc-admin',
  templateUrl: './multi-mc-admin.component.html',
  styleUrls: ['./multi-mc-admin.component.css']
})
export class MultiMcAdminComponent implements OnInit {
  entities: OperatingEntityRow[] = [];
  users: UserRow[] = [];

  loadingEntities = false;
  loadingUsers = false;
  loadingUserAccess = false;
  savingAccess = false;
  savingEntity = false;

  message = '';
  error = '';

  selectedUserId = '';
  selectedUserName = '';
  selectedEntityIds = new Set<string>();
  defaultEntityId = '';

  showEntityForm = false;
  editingEntityId: string | null = null;
  entityForm: {
    name: string;
    legal_name: string;
    dba_name: string;
    mc_number: string;
    dot_number: string;
    address_line1: string;
    city: string;
    state: string;
    zip_code: string;
    entity_type: string;
    is_active: boolean;
  } = {
    name: '',
    legal_name: '',
    dba_name: '',
    mc_number: '',
    dot_number: '',
    address_line1: '',
    city: '',
    state: '',
    zip_code: '',
    entity_type: 'carrier',
    is_active: true
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadEntities();
    this.loadUsers();
  }

  get canSaveAccess(): boolean {
    if (!this.selectedUserId) return false;
    if (this.selectedEntityIds.size === 0) return true;
    return !!this.defaultEntityId && this.selectedEntityIds.has(this.defaultEntityId);
  }

  get selectedUser(): UserRow | null {
    return this.users.find((u) => u.id === this.selectedUserId) || null;
  }

  getDisplayName(user: UserRow): string {
    const full = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return full || user.username || user.email || user.id;
  }

  clearStatus(): void {
    this.message = '';
    this.error = '';
  }

  loadEntities(): void {
    this.loadingEntities = true;
    this.api.listOperatingEntities().subscribe({
      next: (res: any) => {
        this.entities = Array.isArray(res?.data) ? res.data : [];
        this.loadingEntities = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load operating entities';
        this.loadingEntities = false;
      }
    });
  }

  loadUsers(): void {
    this.loadingUsers = true;
    this.api.listUsers().subscribe({
      next: (res: any) => {
        this.users = Array.isArray(res?.data) ? res.data : [];
        this.loadingUsers = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load users';
        this.loadingUsers = false;
      }
    });
  }

  onSelectUser(userId: string): void {
    this.selectedUserId = userId;
    const user = this.users.find((u) => u.id === userId);
    this.selectedUserName = user ? this.getDisplayName(user) : '';
    this.selectedEntityIds = new Set<string>();
    this.defaultEntityId = '';
    if (!userId) return;

    this.loadingUserAccess = true;
    this.api.getUserOperatingEntityAccess(userId).subscribe({
      next: (res: any) => {
        const entities = Array.isArray(res?.data?.entities) ? res.data.entities : [];
        const selectedIds = entities.filter((e: any) => !!e.assigned).map((e: any) => e.id);
        this.selectedEntityIds = new Set(selectedIds);
        const def = entities.find((e: any) => !!e.assigned && !!e.is_default);
        this.defaultEntityId = def?.id || selectedIds[0] || '';
        this.loadingUserAccess = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load user operating entity access';
        this.loadingUserAccess = false;
      }
    });
  }

  toggleEntity(entityId: string): void {
    if (this.selectedEntityIds.has(entityId)) {
      this.selectedEntityIds.delete(entityId);
      if (this.defaultEntityId === entityId) {
        this.defaultEntityId = Array.from(this.selectedEntityIds)[0] || '';
      }
    } else {
      this.selectedEntityIds.add(entityId);
      if (!this.defaultEntityId) {
        this.defaultEntityId = entityId;
      }
    }
    this.selectedEntityIds = new Set(this.selectedEntityIds);
  }

  setDefaultEntity(entityId: string): void {
    if (!this.selectedEntityIds.has(entityId)) {
      this.selectedEntityIds.add(entityId);
    }
    this.defaultEntityId = entityId;
    this.selectedEntityIds = new Set(this.selectedEntityIds);
  }

  saveUserAccess(): void {
    this.clearStatus();
    if (!this.selectedUserId) return;

    const operatingEntityIds = Array.from(this.selectedEntityIds);
    const defaultOperatingEntityId = this.defaultEntityId || null;

    this.savingAccess = true;
    this.api.updateUserOperatingEntityAccess(this.selectedUserId, {
      operatingEntityIds,
      defaultOperatingEntityId
    }).subscribe({
      next: () => {
        this.message = `Saved operating entity access for ${this.selectedUserName || 'user'}.`;
        this.savingAccess = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to save user access';
        this.savingAccess = false;
      }
    });
  }

  openCreateEntity(): void {
    this.clearStatus();
    this.editingEntityId = null;
    this.entityForm = {
      name: '',
      legal_name: '',
      dba_name: '',
      mc_number: '',
      dot_number: '',
      address_line1: '',
      city: '',
      state: '',
      zip_code: '',
      entity_type: 'carrier',
      is_active: true
    };
    this.showEntityForm = true;
  }

  openEditEntity(entity: OperatingEntityRow): void {
    this.clearStatus();
    this.editingEntityId = entity.id;
    this.entityForm = {
      name: entity.name || '',
      legal_name: entity.legal_name || '',
      dba_name: entity.dba_name || '',
      mc_number: entity.mc_number || '',
      dot_number: entity.dot_number || '',
      address_line1: entity.address_line1 || '',
      city: entity.city || '',
      state: entity.state || '',
      zip_code: entity.zip_code || '',
      entity_type: entity.entity_type || 'carrier',
      is_active: entity.is_active !== false
    };
    this.showEntityForm = true;
  }

  closeEntityForm(): void {
    this.showEntityForm = false;
  }

  saveEntity(): void {
    this.clearStatus();
    if (!this.entityForm.name.trim()) {
      this.error = 'Entity name is required';
      return;
    }

    const payload = {
      name: this.entityForm.name.trim(),
      legal_name: this.entityForm.legal_name.trim() || undefined,
      dba_name: this.entityForm.dba_name.trim() || undefined,
      mc_number: this.entityForm.mc_number.trim() || undefined,
      dot_number: this.entityForm.dot_number.trim() || undefined,
      address_line1: this.entityForm.address_line1.trim() || undefined,
      city: this.entityForm.city.trim() || undefined,
      state: this.entityForm.state.trim() || undefined,
      zip_code: this.entityForm.zip_code.trim() || undefined,
      entity_type: this.entityForm.entity_type || 'carrier',
      is_active: this.entityForm.is_active
    };

    this.savingEntity = true;
    const req$ = this.editingEntityId
      ? this.api.updateOperatingEntity(this.editingEntityId, payload)
      : this.api.createOperatingEntity(payload);

    req$.subscribe({
      next: () => {
        this.savingEntity = false;
        this.showEntityForm = false;
        this.message = this.editingEntityId ? 'Operating entity updated.' : 'Operating entity created.';
        this.loadEntities();
        if (this.selectedUserId) this.onSelectUser(this.selectedUserId);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to save operating entity';
        this.savingEntity = false;
      }
    });
  }
}
