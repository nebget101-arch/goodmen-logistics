import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, of, Subscription } from 'rxjs';
import { map, tap, finalize } from 'rxjs/operators';
import { ApiService } from './api.service';

interface CacheEntry {
  data$: BehaviorSubject<unknown[]>;
  lastFetched: number;
  loading: boolean;
  subscription: Subscription | null;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT = 10;
const STORAGE_PREFIX = 'fn_recent_';

type EntityKey = 'customers' | 'vehicles' | 'parts';

@Injectable({
  providedIn: 'root'
})
export class EntityCacheService implements OnDestroy {
  private caches: Record<EntityKey, CacheEntry> = {
    customers: this.createEntry(),
    vehicles: this.createEntry(),
    parts: this.createEntry()
  };

  constructor(private api: ApiService) {}

  ngOnDestroy(): void {
    Object.values(this.caches).forEach(entry => {
      entry.subscription?.unsubscribe();
    });
  }

  getCustomers(forceRefresh = false): Observable<unknown[]> {
    return this.getEntity('customers', forceRefresh);
  }

  getVehicles(forceRefresh = false): Observable<unknown[]> {
    return this.getEntity('vehicles', forceRefresh);
  }

  getParts(forceRefresh = false): Observable<unknown[]> {
    return this.getEntity('parts', forceRefresh);
  }

  /** Returns true when the entity is still loading from the API. */
  isLoading(entity: EntityKey): boolean {
    return this.caches[entity].loading;
  }

  invalidateCache(entity: EntityKey): void {
    const entry = this.caches[entity];
    entry.lastFetched = 0;
    entry.loading = false;
    entry.subscription?.unsubscribe();
    entry.subscription = null;
  }

  addRecentlyUsed(entity: string, item: unknown): void {
    if (!item) return;
    const key = `${STORAGE_PREFIX}${entity}`;
    const existing = this.readStorage(key);
    const id = (item as Record<string, unknown>)['id'];
    const filtered = existing.filter(
      (i: Record<string, unknown>) => i['id'] !== id
    );
    filtered.unshift(item as Record<string, unknown>);
    const trimmed = filtered.slice(0, MAX_RECENT);
    this.writeStorage(key, trimmed);
  }

  getRecentlyUsed(entity: string): unknown[] {
    const key = `${STORAGE_PREFIX}${entity}`;
    return this.readStorage(key);
  }

  // ── private ──

  private getEntity(entity: EntityKey, forceRefresh: boolean): Observable<unknown[]> {
    const entry = this.caches[entity];
    const now = Date.now();
    const isExpired = (now - entry.lastFetched) > TTL_MS;

    if (!forceRefresh && !isExpired && entry.data$.value.length > 0) {
      return entry.data$.asObservable();
    }

    if (entry.loading) {
      return entry.data$.asObservable();
    }

    entry.loading = true;
    const fetch$ = this.fetchEntity(entity);
    entry.subscription = fetch$.pipe(
      tap((items: unknown[]) => {
        entry.data$.next(items);
        entry.lastFetched = Date.now();
      }),
      finalize(() => {
        entry.loading = false;
      })
    ).subscribe();

    return entry.data$.asObservable();
  }

  private fetchEntity(entity: EntityKey): Observable<unknown[]> {
    switch (entity) {
      case 'customers':
        return this.api.getCustomers({ pageSize: 5000 }).pipe(
          map((res: Record<string, unknown>) => {
            const rows = res?.['rows'] ?? res?.['data'] ?? res;
            return Array.isArray(rows) ? rows : [];
          })
        );
      case 'vehicles':
        return this.api.getVehicles().pipe(
          map((res: unknown) => {
            if (Array.isArray(res)) return res;
            const obj = res as Record<string, unknown>;
            const rows = obj?.['rows'] ?? obj?.['data'] ?? obj;
            return Array.isArray(rows) ? rows : [];
          })
        );
      case 'parts':
        return this.api.getParts().pipe(
          map((res: unknown) => {
            if (Array.isArray(res)) return res;
            const obj = res as Record<string, unknown>;
            const rows = obj?.['rows'] ?? obj?.['data'] ?? obj;
            return Array.isArray(rows) ? rows : [];
          })
        );
    }
  }

  private createEntry(): CacheEntry {
    return {
      data$: new BehaviorSubject<unknown[]>([]),
      lastFetched: 0,
      loading: false,
      subscription: null
    };
  }

  private readStorage(key: string): Record<string, unknown>[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeStorage(key: string, items: unknown[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      /* localStorage full or unavailable — silently ignore */
    }
  }
}
