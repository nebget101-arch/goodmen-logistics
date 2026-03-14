import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface OperatingEntityOption {
  id: string;
  name: string;
  mcNumber?: string | null;
  dotNumber?: string | null;
  isDefault?: boolean;
}

export interface OperatingEntityContextState {
  tenantId: string | null;
  accessibleOperatingEntities: OperatingEntityOption[];
  selectedOperatingEntityId: string | null;
  selectedOperatingEntity: OperatingEntityOption | null;
  isLoaded: boolean;
}

const STORAGE_SELECTED_ID = 'selectedOperatingEntityId';
const LEGACY_STORAGE_KEYS = ['operatingEntityId', 'activeOperatingEntityId', 'selectedCompanyId', 'selectedOperatingEntity'];
const DEFAULT_OPERATING_ENTITY_NAME_CANDIDATES = [
  'fleetneuron default operating entity',
  'fleetneurin default operating entity'
];

function normalizeEntityName(value: string | null | undefined): string {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

@Injectable({ providedIn: 'root' })
export class OperatingEntityContextService {
  private state$ = new BehaviorSubject<OperatingEntityContextState>({
    tenantId: null,
    accessibleOperatingEntities: [],
    selectedOperatingEntityId: null,
    selectedOperatingEntity: null,
    isLoaded: false
  });

  private bootstrapStarted = false;

  constructor(private http: HttpClient) {}

  get snapshot(): OperatingEntityContextState {
    return this.state$.value;
  }

  context$(): Observable<OperatingEntityContextState> {
    return this.state$.asObservable();
  }

  getSelectedOperatingEntityId(): string | null {
    return this.snapshot.selectedOperatingEntityId;
  }

  hasMultipleEntities(): boolean {
    return (this.snapshot.accessibleOperatingEntities || []).length > 1;
  }

  initializeFromLoginPayload(payload: any): void {
    const normalized = this.normalizePayload(payload);
    this.applyNormalizedState(normalized, true);
  }

  bootstrapFromSessionIfNeeded(isAuthenticated: boolean, options?: { force?: boolean }): void {
    const force = !!options?.force;
    if (!isAuthenticated) return;
    if (this.bootstrapStarted && !force) return;
    this.bootstrapStarted = true;

    // Do not pre-apply storage value before session/entity list is known.
    // This avoids sending stale headers during bootstrap.
    const preloaded: OperatingEntityContextState = {
      ...this.snapshot,
      selectedOperatingEntityId: this.snapshot.selectedOperatingEntityId,
      selectedOperatingEntity: this.snapshot.selectedOperatingEntity,
      isLoaded: false
    };
    this.state$.next(preloaded);

    const apiUrl = `${(environment.apiUrl || '').replace(/\/api\/?$/, '')}/api/auth/me`;
    this.http.get<any>(apiUrl).pipe(
      map((res) => this.normalizePayload(res?.data ?? res)),
      catchError(() => of(null))
    ).subscribe((normalized) => {
      if (normalized) {
        this.applyNormalizedState(normalized, true);
      } else {
        this.bootstrapStarted = false;
        this.state$.next({
          ...this.snapshot,
          isLoaded: true
        });
      }
    });
  }

  selectOperatingEntity(operatingEntityId: string | null): void {
    const id = (operatingEntityId || '').trim() || null;
    const entities = this.snapshot.accessibleOperatingEntities || [];
    if (!id) return;
    const found = entities.find((entity) => entity.id === id);
    if (!found) return;

    localStorage.setItem(STORAGE_SELECTED_ID, id);
    this.state$.next({
      ...this.snapshot,
      selectedOperatingEntityId: id,
      selectedOperatingEntity: found
    });
  }

  recoverFromStaleSelection(): void {
    const entities = this.snapshot.accessibleOperatingEntities || [];
    const preferred =
      entities.find((entity) => !!entity.isDefault)
      || entities.find((entity) => DEFAULT_OPERATING_ENTITY_NAME_CANDIDATES.includes(normalizeEntityName(entity?.name || '')))
      || entities[0]
      || null;
    const selectedId = preferred?.id || null;

    if (selectedId) {
      localStorage.setItem(STORAGE_SELECTED_ID, selectedId);
    } else {
      localStorage.removeItem(STORAGE_SELECTED_ID);
    }

    this.state$.next({
      ...this.snapshot,
      selectedOperatingEntityId: selectedId,
      selectedOperatingEntity: preferred
    });
  }

  reset(): void {
    this.bootstrapStarted = false;
    localStorage.removeItem(STORAGE_SELECTED_ID);
    LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    this.state$.next({
      tenantId: null,
      accessibleOperatingEntities: [],
      selectedOperatingEntityId: null,
      selectedOperatingEntity: null,
      isLoaded: false
    });
  }

  private readSelectedIdFromStorage(): string | null {
    const fromPrimary = (localStorage.getItem(STORAGE_SELECTED_ID) || '').trim();
    if (fromPrimary) return fromPrimary;

    for (const key of LEGACY_STORAGE_KEYS) {
      if (key === 'selectedOperatingEntity') continue;
      const value = (localStorage.getItem(key) || '').trim();
      if (value) return value;
    }

    const selectedEntityRaw = localStorage.getItem('selectedOperatingEntity');
    if (selectedEntityRaw) {
      try {
        const parsed = JSON.parse(selectedEntityRaw);
        const candidate = (parsed?.id || parsed?.operatingEntityId || '').toString().trim();
        if (candidate) return candidate;
      } catch {
        // ignore malformed value
      }
    }
    return null;
  }

  private normalizePayload(raw: any): { tenantId: string | null; entities: OperatingEntityOption[]; preferredId: string | null } {
    const tenantId =
      (raw?.tenantId || raw?.tenant_id || raw?.user?.tenantId || raw?.user?.tenant_id || null)?.toString?.() || null;

    const candidateLists = [
      raw?.accessibleOperatingEntities,
      raw?.operatingEntities,
      raw?.allowedOperatingEntities,
      raw?.allowed_operating_entities,
      raw?.user?.accessibleOperatingEntities,
      raw?.user?.operatingEntities,
      raw?.context?.accessibleOperatingEntities
    ];

    const list = candidateLists.find((candidate) => Array.isArray(candidate)) || [];
    const entities: OperatingEntityOption[] = list
      .map((entity: any) => {
        const id = (entity?.id || entity?.operatingEntityId || entity?.operating_entity_id || '').toString().trim();
        if (!id) return null;
        const name = (entity?.name || entity?.displayName || entity?.legal_name || entity?.mc_number || id).toString().trim();
        return {
          id,
          name,
          mcNumber: entity?.mcNumber ?? entity?.mc_number ?? null,
          dotNumber: entity?.dotNumber ?? entity?.dot_number ?? null,
          isDefault: !!(entity?.isDefault || entity?.is_default)
        } as OperatingEntityOption;
      })
      .filter((entity: OperatingEntityOption | null): entity is OperatingEntityOption => !!entity);

    const explicitPreferred =
      (raw?.selectedOperatingEntityId || raw?.operatingEntityId || raw?.defaultOperatingEntityId || raw?.default_operating_entity_id || null)
        ?.toString?.()
        ?.trim?.() || null;

    const preferredId = explicitPreferred || entities.find((entity) => !!entity.isDefault)?.id || null;

    return { tenantId, entities, preferredId };
  }

  private applyNormalizedState(
    normalized: { tenantId: string | null; entities: OperatingEntityOption[]; preferredId: string | null },
    allowStorageFallback: boolean
  ): void {
    const entities = normalized.entities || [];
    const fromStorage = allowStorageFallback ? this.readSelectedIdFromStorage() : null;

    const selectedCandidate = [normalized.preferredId, fromStorage]
      .map((id) => (id || '').trim())
      .filter(Boolean)
      .find((id) => entities.some((entity) => entity.id === id));

    const byCandidateId = entities.find((entity) => entity.id === selectedCandidate) || null;
    const byDefaultFlag = entities.find((entity) => !!entity.isDefault) || null;
    const byDefaultName = entities.find((entity) => {
      const normalized = normalizeEntityName(entity?.name || '');
      return DEFAULT_OPERATING_ENTITY_NAME_CANDIDATES.includes(normalized);
    }) || null;

    const selected = byCandidateId || byDefaultFlag || byDefaultName || entities[0] || null;

    if (selected?.id) {
      localStorage.setItem(STORAGE_SELECTED_ID, selected.id);
      LEGACY_STORAGE_KEYS
        .filter((key) => key !== 'selectedOperatingEntity')
        .forEach((key) => localStorage.removeItem(key));
    } else {
      localStorage.removeItem(STORAGE_SELECTED_ID);
      LEGACY_STORAGE_KEYS
        .filter((key) => key !== 'selectedOperatingEntity')
        .forEach((key) => localStorage.removeItem(key));
    }

    this.state$.next({
      tenantId: normalized.tenantId,
      accessibleOperatingEntities: entities,
      selectedOperatingEntityId: selected?.id || null,
      selectedOperatingEntity: selected,
      isLoaded: true
    });
  }
}
