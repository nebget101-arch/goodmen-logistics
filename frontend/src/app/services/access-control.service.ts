import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  UserAccess,
  AccessUser,
  AccessLocation,
  PERMISSIONS,
  ROLES,
  TAB_PERMISSIONS,
} from '../models/access-control.model';

const STORAGE_KEY_ACCESS = 'fleetneuron_access';
const ALWAYS_ALLOWED_PATH_PREFIXES = ['/profile', '/users', '/users/create'];
const INTERNAL_TRIAL_ADMIN_TENANT_NAME = 'fleetneuron default tenant';

/**
 * Centralized RBAC: permissions, roles, and location-aware access.
 * Consumes backend shape { user, roles, permissions, locations } when available;
 * otherwise falls back to role-derived permissions from localStorage for backward compatibility.
 */
@Injectable({ providedIn: 'root' })
export class AccessControlService {
  private access: UserAccess | null = null;
  private loaded = false;

  constructor(private http: HttpClient) {
    this.hydrateFromStorage();
  }

  private get apiUrl(): string {
    return environment.apiUrl?.replace(/\/api\/?$/, '') || '';
  }

  /** Load access from backend (e.g. GET /auth/me or /users/me). Call after login. */
  loadAccess(): Observable<UserAccess | null> {
    const url = `${this.apiUrl}/api/auth/me`;
    return this.http.get<any>(url).pipe(
      map((res) => this.normalizeAccessResponse(res)),
      catchError(() => of(null))
    );
  }

  /** Set access from login response. Call when backend returns { user, roles, permissions, locations } in login. */
  setAccessFromLoginResponse(loginRes: any): void {
    const access = this.normalizeAccessResponse(loginRes);
    if (access) return;
    const role = loginRes?.role ?? localStorage.getItem('role');
    if (role) {
      const roles = [String(role).toLowerCase().trim()];
      const permissions = this.derivePermissionsFromRoles(roles, loginRes ?? {});
      const locations: AccessLocation[] = Array.isArray(loginRes?.locations)
        ? loginRes.locations.map((l: any) => ({ id: l.id ?? l.locationId, name: l.name ?? l.locationName ?? '' }))
        : [];
      this.setAccess({
        user: loginRes?.user ?? { id: loginRes?.userId ?? '', firstName: loginRes?.firstName, lastName: loginRes?.lastName, username: loginRes?.username },
        roles,
        permissions,
        locations,
      });
    }
  }

  /** Normalize API response to UserAccess. Handles { data: { ... } } or { user, roles, ... } or { role } from login. */
  private normalizeAccessResponse(res: any): UserAccess | null {
    const raw = res?.data ?? res;
    if (!raw) return null;
    const user = raw.user ?? { id: raw.userId ?? raw.id ?? '', firstName: raw.firstName, lastName: raw.lastName, username: raw.username, email: raw.email };
    let roles: string[] = Array.isArray(raw.roles) ? raw.roles.map((r: string) => String(r).toLowerCase().trim()) : [];
    if (roles.length === 0 && raw.role) roles = [String(raw.role).toLowerCase().trim()];
    const providedPermissions: string[] = Array.isArray(raw.permissions)
      ? raw.permissions.map((permission: any) => String(permission || '').trim()).filter(Boolean)
      : [];
    const permissions: string[] = providedPermissions.length > 0
      ? providedPermissions
      : this.derivePermissionsFromRoles(roles, raw);
    const locations: AccessLocation[] = Array.isArray(raw.locations)
      ? raw.locations.map((l: any) => ({ id: l.id ?? l.locationId, name: l.name ?? l.locationName ?? '' }))
      : [];
    const access: UserAccess = {
      user,
      roles,
      permissions,
      permissionScopes: raw.permissionScopes ?? raw.scopedPermissions ?? undefined,
      locations,
      tenantId: raw.tenantId ?? null,
      tenantName: raw.tenantName ?? null,
      subscriptionPlanId: raw.subscriptionPlanId ?? null,
      subscriptionPlan: raw.subscriptionPlan ?? null,
    };
    this.setAccess(access);
    return access;
  }

  /** Fallback: derive permissions from roles when backend does not send permissions. */
  derivePermissionsFromRoles(roles: string[], raw: any): string[] {
    const set = new Set<string>();
    const r = (role: string) => roles.includes(role);

    if (r(ROLES.SUPER_ADMIN) || r(ROLES.ADMIN) || r(ROLES.COMPANY_ADMIN)) {
      Object.values(PERMISSIONS).forEach((p) => set.add(p));
      return Array.from(set);
    }

    if (r('executive_read_only')) {
      set.add(PERMISSIONS.DASHBOARD_VIEW).add(PERMISSIONS.REPORTS_VIEW).add(PERMISSIONS.LOADS_VIEW).add(PERMISSIONS.INVOICES_VIEW);
      return Array.from(set);
    }

    if (r('dispatch_manager') || r('dispatcher')) {
      set.add(PERMISSIONS.DASHBOARD_VIEW).add(PERMISSIONS.LOADS_VIEW).add(PERMISSIONS.LOADS_CREATE).add(PERMISSIONS.LOADS_EDIT).add(PERMISSIONS.LOADS_ASSIGN);
      set.add(PERMISSIONS.DRIVERS_VIEW).add(PERMISSIONS.BROKERS_VIEW).add(PERMISSIONS.VEHICLES_VIEW);
      set.add(PERMISSIONS.ROADSIDE_VIEW).add(PERMISSIONS.ROADSIDE_MANAGE);
    }
    if (r('safety_manager') || r('safety')) {
      set.add(PERMISSIONS.DASHBOARD_VIEW).add(PERMISSIONS.DRIVERS_VIEW).add(PERMISSIONS.DRIVERS_EDIT).add(PERMISSIONS.DQF_VIEW).add(PERMISSIONS.DQF_EDIT);
      set.add(PERMISSIONS.HOS_VIEW).add(PERMISSIONS.AUDIT_VIEW).add(PERMISSIONS.VEHICLES_VIEW);
    }
    if (r('carrier_accountant') || r('accounting') || r('company_accountant')) {
      set.add(PERMISSIONS.DASHBOARD_VIEW).add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.INVOICES_VIEW).add(PERMISSIONS.INVOICES_CREATE).add(PERMISSIONS.INVOICES_EDIT).add(PERMISSIONS.INVOICES_EXPORT);
      set.add(PERMISSIONS.SALES_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('shop_manager') || r('service_writer')) {
      set.add(PERMISSIONS.DASHBOARD_VIEW).add(PERMISSIONS.MAINTENANCE_VIEW).add(PERMISSIONS.WORK_ORDERS_VIEW).add(PERMISSIONS.WORK_ORDERS_CREATE).add(PERMISSIONS.WORK_ORDERS_EDIT).add(PERMISSIONS.WORK_ORDERS_FINALIZE);
      set.add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.INVOICES_VIEW).add(PERMISSIONS.INVOICES_CREATE).add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
      set.add(PERMISSIONS.ROADSIDE_VIEW).add(PERMISSIONS.ROADSIDE_MANAGE);
    }
    if (r('shop_clerk')) {
      // Operational shop access: create/view/edit customers, vehicles, work orders,
      // estimates, draft invoices, payments (view/create), and documents.
      // Intentionally excludes: post/void invoices, adjust inventory, approve discounts,
      // close/approve work orders, refund payments, settlements, users/roles.
      set.add(PERMISSIONS.DASHBOARD_VIEW)
        .add(PERMISSIONS.MAINTENANCE_VIEW)
        .add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.CUSTOMERS_CREATE).add(PERMISSIONS.CUSTOMERS_EDIT)
        .add(PERMISSIONS.VEHICLES_VIEW).add(PERMISSIONS.VEHICLES_CREATE).add(PERMISSIONS.VEHICLES_EDIT)
        .add(PERMISSIONS.WORK_ORDERS_VIEW).add(PERMISSIONS.WORK_ORDERS_CREATE).add(PERMISSIONS.WORK_ORDERS_EDIT).add(PERMISSIONS.WORK_ORDERS_ASSIGN)
        .add(PERMISSIONS.WORK_ORDER_LINES_VIEW).add(PERMISSIONS.WORK_ORDER_LINES_CREATE).add(PERMISSIONS.WORK_ORDER_LINES_EDIT)
        .add(PERMISSIONS.ESTIMATES_VIEW).add(PERMISSIONS.ESTIMATES_CREATE).add(PERMISSIONS.ESTIMATES_EDIT).add(PERMISSIONS.ESTIMATES_CONVERT)
        .add(PERMISSIONS.APPOINTMENTS_VIEW).add(PERMISSIONS.APPOINTMENTS_CREATE).add(PERMISSIONS.APPOINTMENTS_EDIT)
        .add(PERMISSIONS.INVOICES_VIEW).add(PERMISSIONS.INVOICES_CREATE).add(PERMISSIONS.INVOICES_EDIT)
        .add(PERMISSIONS.PAYMENTS_VIEW).add(PERMISSIONS.PAYMENTS_CREATE)
        .add(PERMISSIONS.INVENTORY_VIEW)
        .add(PERMISSIONS.PARTS_VIEW)
        .add(PERMISSIONS.DOCUMENTS_VIEW).add(PERMISSIONS.DOCUMENTS_UPLOAD);
    }
    if (r('shop_manager')) {
      // shop_manager is a superset of shop_clerk plus all finalization permissions.
      set.add(PERMISSIONS.CUSTOMERS_CREATE).add(PERMISSIONS.VEHICLES_CREATE)
        .add(PERMISSIONS.WORK_ORDERS_ASSIGN).add(PERMISSIONS.WORK_ORDERS_APPROVE).add(PERMISSIONS.WORK_ORDERS_CLOSE)
        .add(PERMISSIONS.WORK_ORDER_LINES_VIEW).add(PERMISSIONS.WORK_ORDER_LINES_CREATE).add(PERMISSIONS.WORK_ORDER_LINES_EDIT)
        .add(PERMISSIONS.ESTIMATES_VIEW).add(PERMISSIONS.ESTIMATES_CREATE).add(PERMISSIONS.ESTIMATES_EDIT)
        .add(PERMISSIONS.ESTIMATES_CONVERT).add(PERMISSIONS.ESTIMATES_APPROVE)
        .add(PERMISSIONS.APPOINTMENTS_VIEW).add(PERMISSIONS.APPOINTMENTS_CREATE).add(PERMISSIONS.APPOINTMENTS_EDIT)
        .add(PERMISSIONS.INVOICES_POST).add(PERMISSIONS.INVOICES_VOID).add(PERMISSIONS.INVOICES_CREATE).add(PERMISSIONS.INVOICES_EDIT)
        .add(PERMISSIONS.PAYMENTS_VIEW).add(PERMISSIONS.PAYMENTS_CREATE).add(PERMISSIONS.PAYMENTS_REFUND)
        .add(PERMISSIONS.DOCUMENTS_VIEW).add(PERMISSIONS.DOCUMENTS_UPLOAD)
        .add(PERMISSIONS.DISCOUNTS_APPROVE)
        .add(PERMISSIONS.REPORTS_SHOP);
    }
    if (r('mechanic')) {
      set.add(PERMISSIONS.MAINTENANCE_VIEW).add(PERMISSIONS.WORK_ORDERS_VIEW).add(PERMISSIONS.WORK_ORDERS_EDIT);
      set.add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.RECEIVING_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('parts_manager') || r('shop_manager')) {
      set.add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.PARTS_EDIT).add(PERMISSIONS.PARTS_RECEIVE).add(PERMISSIONS.INVENTORY_VIEW).add(PERMISSIONS.INVENTORY_TRANSFER).add(PERMISSIONS.INVENTORY_ADJUST);
      set.add(PERMISSIONS.BARCODES_VIEW).add(PERMISSIONS.BARCODES_EDIT).add(PERMISSIONS.RECEIVING_VIEW).add(PERMISSIONS.RECEIVING_RECEIVE);
      set.add(PERMISSIONS.SALES_VIEW).add(PERMISSIONS.SALES_CREATE).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('parts_clerk')) {
      set.add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.PARTS_EDIT).add(PERMISSIONS.PARTS_RECEIVE).add(PERMISSIONS.RECEIVING_VIEW).add(PERMISSIONS.RECEIVING_RECEIVE);
      set.add(PERMISSIONS.INVENTORY_VIEW).add(PERMISSIONS.INVENTORY_TRANSFER).add(PERMISSIONS.SALES_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('inventory_auditor')) {
      set.add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.INVENTORY_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('service_advisor')) {
      set.add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.INVOICES_VIEW).add(PERMISSIONS.SALES_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
    }
    if (r('technician')) {
      set.add(PERMISSIONS.MAINTENANCE_VIEW).add(PERMISSIONS.WORK_ORDERS_VIEW).add(PERMISSIONS.CUSTOMERS_VIEW).add(PERMISSIONS.PARTS_VIEW).add(PERMISSIONS.RECEIVING_VIEW).add(PERMISSIONS.INVENTORY_REPORTS_VIEW);
      set.add(PERMISSIONS.ROADSIDE_VIEW);
    }
    if (r('driver')) {
      set.add(PERMISSIONS.LOADS_VIEW);
    }

    return Array.from(set);
  }

  setAccess(access: UserAccess | null): void {
    this.access = access;
    this.loaded = true;
    if (access) {
      try {
        localStorage.setItem(STORAGE_KEY_ACCESS, JSON.stringify(access));
      } catch {
        // ignore
      }
    } else {
      localStorage.removeItem(STORAGE_KEY_ACCESS);
    }
  }

  /** Restore from localStorage (e.g. after refresh). */
  hydrateFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACCESS);
      if (raw) {
        this.access = JSON.parse(raw);
        this.loaded = true;
      }
    } catch {
      this.access = null;
    }
  }

  clearAccess(): void {
    this.access = null;
    this.loaded = true;
    localStorage.removeItem(STORAGE_KEY_ACCESS);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getAccess(): UserAccess | null {
    return this.access;
  }

  getUser(): AccessUser | null {
    return this.access?.user ?? null;
  }

  getRoles(): string[] {
    return this.access?.roles ?? [];
  }

  getPermissions(): string[] {
    return this.access?.permissions ?? [];
  }

  getSubscriptionPlanId(): string | null {
    return this.access?.subscriptionPlanId ?? null;
  }

  getTenantName(): string | null {
    return this.access?.tenantName ?? null;
  }

  getSubscriptionPlan(): UserAccess['subscriptionPlan'] {
    return this.access?.subscriptionPlan ?? null;
  }

  getLocations(): AccessLocation[] {
    return this.access?.locations ?? [];
  }

  /** Allowed location IDs (for filtering). Empty = no restriction = all locations (e.g. super_admin). */
  getAllowedLocationIds(): string[] {
    const locs = this.access?.locations;
    if (!locs || locs.length === 0) return [];
    return locs.map((l) => l.id);
  }

  hasPermission(code: string): boolean {
    if (!code) return false;
    const perms = this.getPermissions();
    if (perms.includes(code)) return true;
    if (this.hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COMPANY_ADMIN])) return true;
    return false;
  }

  hasAnyPermission(codes: string[]): boolean {
    if (!codes?.length) return false;
    return codes.some((c) => this.hasPermission(c));
  }

  hasRole(role: string): boolean {
    if (!role) return false;
    const r = role.toLowerCase().trim();
    return this.getRoles().includes(r);
  }

  hasAnyRole(roles: string[]): boolean {
    if (!roles?.length) return false;
    return roles.some((r) => this.hasRole(r));
  }

  hasLocation(locationId: string): boolean {
    if (!locationId) return false;
    const ids = this.getAllowedLocationIds();
    if (ids.length === 0) return true; // no restriction
    return ids.includes(locationId);
  }

  canAccessLocation(locationId: string): boolean {
    return this.hasLocation(locationId);
  }

  /**
   * Filter a list of locations to only those the user can access.
   * If user has no location restriction (e.g. super_admin), returns the same list.
   */
  getFilteredLocations<T extends { id?: string; locationId?: string }>(all: T[]): T[] {
    const allowedIds = this.getAllowedLocationIds();
    if (allowedIds.length === 0) return all;
    return all.filter((item) => {
      const id = item.id ?? item.locationId;
      return id && allowedIds.includes(id);
    });
  }

  /**
   * Filter locations by allowed ids. Use when you have AccessLocation[] or { id, name }[].
   */
  filterLocationsById<T extends { id: string }>(all: T[]): T[] {
    const allowedIds = this.getAllowedLocationIds();
    if (allowedIds.length === 0) return all;
    return all.filter((item) => allowedIds.includes(item.id));
  }

  /**
   * Whether the user can see a given nav tab / feature.
   * Uses TAB_PERMISSIONS map; any matching permission grants access.
   */
  canSee(tab: string): boolean {
    if (!tab) return false;
    const key = tab.toLowerCase().trim();
    const perms = TAB_PERMISSIONS[key];
    if (!perms?.length) return false;
    return this.hasAnyPermission(perms);
  }

  /** Whether the user can see any of the given nav tabs. */
  canSeeAny(tabs: string[]): boolean {
    if (!tabs?.length) return false;
    return tabs.some((t) => this.canSee(t));
  }

  /** For executive_read_only: hide edit/create actions. */
  isReadOnly(): boolean {
    return this.hasRole('executive_read_only');
  }

  /** Whether current user has any location restriction (false = can see all locations). */
  hasLocationRestriction(): boolean {
    return this.getAllowedLocationIds().length > 0;
  }

  canAccessUrl(url: string): boolean {
    const normalized = this.normalizeUrl(url);
    if (!normalized) return false;
    if (ALWAYS_ALLOWED_PATH_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
      return true;
    }

    // Backward compatibility for older cached access payloads where Basic plan
    // includedPages might not yet include full settlements paths.
    if (
      this.getSubscriptionPlanId() === 'basic'
      && (normalized === '/settlements' || normalized.startsWith('/settlements/'))
    ) {
      return true;
    }

    const plan = this.getSubscriptionPlan();
    const allowedPages = Array.isArray(plan?.includedPages) ? plan?.includedPages ?? [] : [];
    if (!allowedPages.length) return true;

    return allowedPages.some((page) => {
      const allowed = this.normalizeUrl(page);
      return normalized === allowed || normalized.startsWith(`${allowed}/`);
    });
  }

  isInternalTrialAdminTenant(): boolean {
    return String(this.getTenantName() || '').trim().toLowerCase() === INTERNAL_TRIAL_ADMIN_TENANT_NAME;
  }

  canAccessTrialRequestsAdmin(): boolean {
    if (!this.isInternalTrialAdminTenant()) return false;
    return this.hasAnyRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.COMPANY_ADMIN]);
  }

  private normalizeUrl(url: string): string {
    const value = String(url || '').trim();
    if (!value) return '';
    const withoutQuery = value.split('?')[0].split('#')[0].trim();
    if (!withoutQuery) return '';
    const prefixed = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
    return prefixed.length > 1 ? prefixed.replace(/\/+$/, '') : prefixed;
  }
}
