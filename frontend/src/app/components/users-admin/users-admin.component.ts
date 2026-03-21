import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AccessControlService } from '../../services/access-control.service';
import { NAV_TOP_LINKS, NAV_SECTIONS } from '../../config/nav.config';
import { RBAC_ROLES, RbacRoleOption, getVisibleRbacRolesForPlan } from '../../config/rbac-roles.config';
import { TAB_PERMISSIONS } from '../../models/access-control.model';

interface UserListRole {
  code: string;
  name?: string;
}

interface UserListRecord {
  id: string;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean;
  tenant_id?: string | null;
  created_at?: string | null;
  roles?: UserListRole[];
}

interface RoleAccessSummary {
  role: RbacRoleOption;
  pages: Array<{ path: string; label: string }>;
}

interface SeatUsagePayload {
  planId?: string;
  includedUsers: number | null;
  extraPaidSeats: number;
  effectiveSeatLimit: number | null;
  activeUsers: number;
  additionalUserPriceUsd: number | null;
  canPurchaseExtraSeat: boolean;
  purchaseBlockedReason?: string | null;
}

@Component({
  selector: 'app-users-admin',
  templateUrl: './users-admin.component.html',
  styleUrls: ['./users-admin.component.css']
})
export class UsersAdminComponent implements OnInit {
  activeTab: 'users' | 'roles' = 'users';
  loadingUsers = false;
  error = '';
  searchQuery = '';
  users: UserListRecord[] = [];
  actionLoadingUserId: string | null = null;

  viewingUser: UserListRecord | null = null;
  editingUser: UserListRecord | null = null;
  editForm = {
    username: '',
    firstName: '',
    lastName: '',
    email: '',
    roles: [] as string[]
  };
  savingEdit = false;

  seatUsage: SeatUsagePayload | null = null;
  loadingSeatUsage = false;
  purchasingSeats = false;

  private readonly userPageCatalog: Array<{ path: string; label: string; tab: string }> = [
    ...NAV_TOP_LINKS.map((link) => ({ path: link.path, label: link.label, tab: link.tab })),
    ...NAV_SECTIONS.flatMap((section) => section.children.map((child) => ({ path: child.path, label: child.label, tab: child.tab }))),
    { path: '/admin/multi-mc', label: 'Company Access Admin', tab: 'users' },
    { path: '/users', label: 'Users', tab: 'users' },
    { path: '/users/create', label: 'Add User', tab: 'users' }
  ];

  constructor(
    private api: ApiService,
    private router: Router,
    public access: AccessControlService
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  setActiveTab(tab: 'users' | 'roles'): void {
    this.activeTab = tab;
  }

  loadUsers(): void {
    this.loadingUsers = true;
    this.error = '';

    this.api.listUsers().subscribe({
      next: (res: any) => {
        this.users = Array.isArray(res?.data) ? res.data : [];
        this.loadingUsers = false;
        this.loadSeatUsage();
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to load users';
        this.loadingUsers = false;
      }
    });
  }

  loadSeatUsage(): void {
    this.loadingSeatUsage = true;
    this.api.getBillingSeatUsage().subscribe({
      next: (res: any) => {
        this.seatUsage = (res?.data || null) as SeatUsagePayload | null;
        this.loadingSeatUsage = false;
      },
      error: () => {
        this.seatUsage = null;
        this.loadingSeatUsage = false;
      }
    });
  }

  purchaseExtraSeat(): void {
    if (!this.seatUsage?.canPurchaseExtraSeat) return;
    this.purchasingSeats = true;
    this.error = '';
    this.api.purchaseBillingExtraSeats(1).subscribe({
      next: () => {
        this.purchasingSeats = false;
        this.loadSeatUsage();
        this.loadUsers();
      },
      error: (err: any) => {
        this.purchasingSeats = false;
        this.error = err?.error?.error || 'Failed to purchase extra seat';
      }
    });
  }

  addUser(): void {
    if (this.isAtOrAboveIncludedUserLimit) {
      this.error = this.userLimitMessage;
      return;
    }
    this.router.navigate(['/users/create']);
  }

  canManageUsers(): boolean {
    return this.access.hasAnyPermission(['users.edit', 'users.manage', 'roles.manage']);
  }

  viewUser(user: UserListRecord): void {
    this.api.getUserById(user.id).subscribe({
      next: (res: any) => {
        this.viewingUser = ((res?.data || user) as UserListRecord);
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to load user details';
      }
    });
  }

  closeViewModal(): void {
    this.viewingUser = null;
  }

  openEditUser(user: UserListRecord): void {
    this.api.getUserById(user.id).subscribe({
      next: (res: any) => {
        const details = ((res?.data || user) as UserListRecord);
        this.editingUser = details;
        this.editForm = {
          username: String(details.username || '').trim(),
          firstName: String(details.first_name || '').trim(),
          lastName: String(details.last_name || '').trim(),
          email: String(details.email || '').trim(),
          roles: (details.roles || []).map((role) => String(role.code || '').trim().toLowerCase()).filter(Boolean)
        };

        if (!this.editForm.roles.length && details.role) {
          const normalized = String(details.role).trim().toLowerCase();
          this.editForm.roles = [normalized === 'dispatch' ? 'dispatcher' : normalized];
        }
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to load user details for editing';
      }
    });
  }

  closeEditModal(): void {
    this.editingUser = null;
    this.savingEdit = false;
  }

  toggleEditRole(roleCode: string): void {
    const code = String(roleCode || '').trim().toLowerCase();
    if (!code) return;
    if (this.editForm.roles.includes(code)) {
      this.editForm.roles = this.editForm.roles.filter((value) => value !== code);
    } else {
      this.editForm.roles = [...this.editForm.roles, code];
    }
  }

  saveUserEdit(): void {
    if (!this.editingUser) return;
    const userId = this.editingUser.id;

    if (!this.editForm.username.trim()) {
      this.error = 'Username is required.';
      return;
    }

    if (!this.editForm.roles.length) {
      this.error = 'Select at least one role.';
      return;
    }

    this.error = '';
    this.savingEdit = true;

    this.api.updateUser(userId, {
      username: this.editForm.username.trim(),
      firstName: this.editForm.firstName.trim() || null,
      lastName: this.editForm.lastName.trim() || null,
      email: this.editForm.email.trim() || null,
      role: this.editForm.roles[0],
      roles: this.editForm.roles
    }).subscribe({
      next: (res: any) => {
        const updated = (res?.data || {}) as UserListRecord;
        this.users = this.users.map((user) => user.id === userId ? { ...user, ...updated } : user);
        this.savingEdit = false;
        this.closeEditModal();
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to update user';
        this.savingEdit = false;
      }
    });
  }

  toggleUserActive(user: UserListRecord): void {
    if (!this.canManageUsers()) return;

    const nextActive = user.is_active === false;
    if (nextActive && this.isAtOrAboveIncludedUserLimit) {
      this.error = this.userLimitMessage;
      return;
    }

    const actionText = nextActive ? 'activate' : 'inactivate';
    const confirmed = window.confirm(`Are you sure you want to ${actionText} ${this.formatUserName(user)}?`);
    if (!confirmed) return;

    this.actionLoadingUserId = user.id;
    this.error = '';

    this.api.setUserActive(user.id, nextActive).subscribe({
      next: (res: any) => {
        const updated = (res?.data || {}) as UserListRecord;
        this.users = this.users.map((row) => row.id === user.id ? { ...row, ...updated } : row);
        this.actionLoadingUserId = null;
        this.loadSeatUsage();
      },
      error: (err: any) => {
        this.error = err?.error?.error || 'Failed to update user status';
        this.actionLoadingUserId = null;
      }
    });
  }

  get filteredUsers(): UserListRecord[] {
    const query = String(this.searchQuery || '').trim().toLowerCase();
    if (!query) return this.users;

    return this.users.filter((user) => {
      const haystack = [
        user.username,
        user.first_name,
        user.last_name,
        user.email,
        user.role,
        ...(user.roles || []).map((role) => role.code),
        ...(user.roles || []).map((role) => role.name)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }

  get visibleRoles(): RbacRoleOption[] {
    return getVisibleRbacRolesForPlan(this.access.getSubscriptionPlanId());
  }

  get roleAccessSummaries(): RoleAccessSummary[] {
    return this.visibleRoles.map((role) => ({
      role,
      pages: this.getPagesForRole(role.value)
    }));
  }

  get planName(): string {
    return this.access.getSubscriptionPlan()?.name || 'Current plan';
  }

  get includedUsersLabel(): string {
    const limit = this.effectiveSeatLimit;
    if (limit == null) return 'Plan-based user access';
    const active = this.activeUserCount;
    const extra = this.seatUsage?.extraPaidSeats;
    if (this.seatUsage != null && Number(extra) > 0) {
      const inc = this.seatUsage.includedUsers;
      return `${active}/${limit} active (${inc ?? '—'} incl. + ${extra} paid)`;
    }
    return `${active}/${limit} active users`;
  }

  get currentUserCount(): number {
    return this.users.length;
  }

  get activeUserCount(): number {
    if (this.seatUsage != null && Number.isFinite(Number(this.seatUsage.activeUsers))) {
      return Number(this.seatUsage.activeUsers);
    }
    return this.users.filter((user) => user.is_active !== false).length;
  }

  get effectiveSeatLimit(): number | null {
    if (this.seatUsage != null && this.seatUsage.effectiveSeatLimit != null) {
      return this.seatUsage.effectiveSeatLimit;
    }
    return this.includedUsersLimit;
  }

  get extraSeatPriceLabel(): string {
    const n = this.seatUsage?.additionalUserPriceUsd;
    if (Number.isFinite(Number(n))) return `$${Number(n)}/mo`;
    return '$25/mo';
  }

  get includedUsersLimit(): number | null {
    const includedUsers = Number(this.access.getSubscriptionPlan()?.includedUsers);
    if (!Number.isFinite(includedUsers) || includedUsers <= 0) return null;
    return includedUsers;
  }

  get isAtOrAboveIncludedUserLimit(): boolean {
    const limit = this.effectiveSeatLimit;
    if (limit == null) return false;
    return this.activeUserCount >= limit;
  }

  get userLimitMessage(): string {
    const limit = this.effectiveSeatLimit;
    if (limit == null) return '';
    if (this.activeUserCount < limit) return '';
    if (this.seatUsage?.canPurchaseExtraSeat) {
      const price = this.seatUsage.additionalUserPriceUsd;
      const label = Number.isFinite(Number(price)) ? `$${Number(price)}` : '$25';
      return `You've reached your seat limit. Add a paid seat (${label}/user/mo) with the button below, or contact support.`;
    }
    if (this.seatUsage?.purchaseBlockedReason) {
      return `${this.seatUsage.purchaseBlockedReason} Contact support if you need help.`;
    }
    return 'User limit reached for your current plan. Contact support to add more users.';
  }

  formatUserName(user: UserListRecord): string {
    const fullName = [user.first_name || '', user.last_name || ''].filter(Boolean).join(' ').trim();
    return fullName || user.username || 'User';
  }

  getUserRoleLabels(user: UserListRecord): string[] {
    const labelsFromRbac = (user.roles || [])
      .map((role) => this.getRoleLabel(role.code))
      .filter(Boolean);

    if (labelsFromRbac.length > 0) {
      return Array.from(new Set(labelsFromRbac));
    }

    const fallback = this.getRoleLabel(user.role || '');
    return fallback ? [fallback] : [];
  }

  getPrimaryRoleLabel(user: UserListRecord): string {
    return this.getUserRoleLabels(user)[0] || '—';
  }

  getUserStatusLabel(user: UserListRecord): string {
    if (user.is_active === false) return 'Inactive';
    return 'Active';
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
  }

  trackByUserId(_: number, user: UserListRecord): string {
    return user.id;
  }

  private getPagesForRole(roleCode: string): Array<{ path: string; label: string }> {
    const permissions = this.access.derivePermissionsFromRoles([roleCode], {});

    return this.userPageCatalog.filter((page) => {
      if (!this.access.canAccessUrl(page.path)) return false;

      if (page.tab === 'users') {
        return permissions.some((permission) => [
          'users.view',
          'users.create',
          'users.edit',
          'roles.manage',
          'access.admin'
        ].includes(permission));
      }

      return this.hasTabAccessFromPermissions(page.tab, permissions);
    });
  }

  private hasTabAccessFromPermissions(tab: string, permissions: string[]): boolean {
    const requiredPermissions = TAB_PERMISSIONS[String(tab || '').trim().toLowerCase()] || [];
    if (!requiredPermissions.length) return false;
    return requiredPermissions.some((permission) => permissions.includes(permission));
  }

  private getRoleLabel(roleCode: string): string {
    const normalized = String(roleCode || '').trim().toLowerCase();
    return RBAC_ROLES.find((role) => role.value === normalized)?.label || normalized;
  }
}
