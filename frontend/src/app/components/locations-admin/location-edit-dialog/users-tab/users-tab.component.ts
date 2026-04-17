import {
  Component,
  Input,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core';
import { FormControl } from '@angular/forms';
import { ApiService, LocationUserRecord } from '../../../../services/api.service';

/**
 * Lightweight representation of a tenant user returned by GET /api/users.
 * Only the fields this component actually reads are listed.
 */
interface TenantUser {
  id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean;
}

@Component({
  selector: 'app-users-tab',
  templateUrl: './users-tab.component.html',
  styleUrls: ['./users-tab.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersTabComponent implements OnInit, OnChanges {
  /** The location whose user assignments are managed. */
  @Input() locationId = '';

  // ── state ──────────────────────────────────────────────────────────
  assignedUsers: LocationUserRecord[] = [];
  loading = false;
  error = '';
  successMessage = '';

  /** Controls the "Assign User" flow. */
  showAssignPanel = false;
  assignSearchCtrl = new FormControl('');
  allTenantUsers: TenantUser[] = [];
  filteredSuggestions: TenantUser[] = [];
  selectedUsers: TenantUser[] = [];
  assignLoading = false;

  /** Tracks the user-id currently pending removal confirmation. */
  confirmingRemoveId: string | null = null;
  removeLoading = false;

  constructor(
    private api: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────
  ngOnInit(): void {
    if (this.locationId) {
      this.loadAssignedUsers();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['locationId'] && !changes['locationId'].firstChange) {
      this.loadAssignedUsers();
    }
  }

  // ── data loading ───────────────────────────────────────────────────
  loadAssignedUsers(): void {
    if (!this.locationId) return;
    this.loading = true;
    this.error = '';
    this.api.getLocationUsers(this.locationId).subscribe({
      next: (res) => {
        this.assignedUsers = res?.data ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to load assigned users';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── assign panel ───────────────────────────────────────────────────
  openAssignPanel(): void {
    this.showAssignPanel = true;
    this.selectedUsers = [];
    this.assignSearchCtrl.setValue('');
    this.filteredSuggestions = [];
    this.loadAllUsers();
  }

  closeAssignPanel(): void {
    this.showAssignPanel = false;
    this.selectedUsers = [];
    this.filteredSuggestions = [];
  }

  private loadAllUsers(): void {
    this.api.listUsers().subscribe({
      next: (res: { data?: TenantUser[] }) => {
        const users: TenantUser[] = Array.isArray(res?.data) ? res.data : [];
        // Only show active users
        this.allTenantUsers = users.filter((u) => u.is_active !== false);
        this.filterSuggestions();
        this.cdr.markForCheck();
      },
      error: () => {
        this.allTenantUsers = [];
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput(): void {
    this.filterSuggestions();
  }

  private filterSuggestions(): void {
    const assignedIds = new Set(this.assignedUsers.map((u) => u.user_id));
    const selectedIds = new Set(this.selectedUsers.map((u) => u.id));
    const term = (this.assignSearchCtrl.value || '').toLowerCase().trim();

    this.filteredSuggestions = this.allTenantUsers.filter((u) => {
      // Exclude already-assigned and already-selected
      if (assignedIds.has(u.id) || selectedIds.has(u.id)) return false;

      if (!term) return true;
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      return (
        fullName.includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        u.username.toLowerCase().includes(term)
      );
    });
  }

  selectUser(user: TenantUser): void {
    if (!this.selectedUsers.find((u) => u.id === user.id)) {
      this.selectedUsers = [...this.selectedUsers, user];
    }
    this.assignSearchCtrl.setValue('');
    this.filterSuggestions();
  }

  deselectUser(user: TenantUser): void {
    this.selectedUsers = this.selectedUsers.filter((u) => u.id !== user.id);
    this.filterSuggestions();
  }

  submitAssign(): void {
    if (!this.selectedUsers.length || this.assignLoading) return;
    this.assignLoading = true;
    this.error = '';
    this.successMessage = '';

    const ids = this.selectedUsers.map((u) => u.id);
    this.api.assignLocationUsers(this.locationId, ids).subscribe({
      next: () => {
        this.successMessage = `${ids.length} user(s) assigned successfully.`;
        this.assignLoading = false;
        this.closeAssignPanel();
        this.loadAssignedUsers();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to assign users';
        this.assignLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── remove ─────────────────────────────────────────────────────────
  confirmRemove(userId: string): void {
    this.confirmingRemoveId = userId;
  }

  cancelRemove(): void {
    this.confirmingRemoveId = null;
  }

  executeRemove(userId: string): void {
    this.removeLoading = true;
    this.error = '';
    this.successMessage = '';

    this.api.removeLocationUser(this.locationId, userId).subscribe({
      next: () => {
        this.successMessage = 'User removed from location.';
        this.confirmingRemoveId = null;
        this.removeLoading = false;
        this.loadAssignedUsers();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.error || err?.message || 'Failed to remove user';
        this.confirmingRemoveId = null;
        this.removeLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // ── helpers ────────────────────────────────────────────────────────
  formatName(user: LocationUserRecord): string {
    const first = user.first_name || '';
    const last = user.last_name || '';
    const full = `${first} ${last}`.trim();
    return full || user.username;
  }

  formatTenantName(user: TenantUser): string {
    const first = user.first_name || '';
    const last = user.last_name || '';
    const full = `${first} ${last}`.trim();
    return full || user.username;
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '--' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  trackByUserId(_index: number, user: LocationUserRecord): string {
    return user.user_id;
  }

  trackByTenantUserId(_index: number, user: TenantUser): string {
    return user.id;
  }
}
