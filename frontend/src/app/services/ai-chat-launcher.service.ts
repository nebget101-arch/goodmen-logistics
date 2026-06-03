import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type AiChatLauncherState = 'default' | 'minimized';

/**
 * FN-1356: Tracks Ask Neuron FAB display state (full pill vs. circular orb)
 * with localStorage persistence. On first load with no saved preference, the
 * launcher starts minimized on viewports <= 639px to avoid covering the
 * thumb-zone form fields on phones.
 */
@Injectable({ providedIn: 'root' })
export class AiChatLauncherService {
  static readonly STORAGE_KEY = 'neuronFabState';
  static readonly MOBILE_BREAKPOINT_QUERY = '(max-width: 639px)';

  private readonly stateSubject = new BehaviorSubject<AiChatLauncherState>(
    this.computeInitialState()
  );

  readonly state$: Observable<AiChatLauncherState> = this.stateSubject.asObservable();

  get state(): AiChatLauncherState {
    return this.stateSubject.value;
  }

  setState(next: AiChatLauncherState): void {
    if (this.stateSubject.value === next) return;
    this.stateSubject.next(next);
    this.persist(next);
  }

  toggle(): void {
    this.setState(this.stateSubject.value === 'default' ? 'minimized' : 'default');
  }

  private computeInitialState(): AiChatLauncherState {
    const persisted = this.readPersisted();
    if (persisted) return persisted;
    return this.matchesMobile() ? 'minimized' : 'default';
  }

  private readPersisted(): AiChatLauncherState | null {
    try {
      const raw = localStorage.getItem(AiChatLauncherService.STORAGE_KEY);
      return raw === 'default' || raw === 'minimized' ? raw : null;
    } catch {
      return null;
    }
  }

  private persist(value: AiChatLauncherState): void {
    try {
      localStorage.setItem(AiChatLauncherService.STORAGE_KEY, value);
    } catch {
      /* localStorage unavailable (private mode / SSR); ignore. */
    }
  }

  private matchesMobile(): boolean {
    try {
      return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(AiChatLauncherService.MOBILE_BREAKPOINT_QUERY).matches;
    } catch {
      return false;
    }
  }
}
