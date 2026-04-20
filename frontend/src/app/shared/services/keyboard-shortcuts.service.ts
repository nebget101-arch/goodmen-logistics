import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * A keyboard shortcut binding registered with {@link KeyboardShortcutsService}.
 *
 * `ctrlOrCmd` is true when the shortcut requires the Cmd key on macOS or the
 * Ctrl key on Windows/Linux. Modifier flags are matched exactly — a binding
 * with `shift: true` will not fire without Shift, and a binding without
 * `shift` will not fire when Shift is held.
 */
export interface ShortcutBinding {
  /** Unique id for this binding — used by `unregister()` and to avoid duplicates. */
  id: string;

  /** `event.key` value, case-insensitive. e.g. "n", "/", "?", "k", "s", "Escape". */
  key: string;

  /** User-facing description shown in the help modal (e.g. "New load"). */
  description: string;

  /** Grouping label for the help modal (e.g. "Loads list", "Load wizard"). */
  group?: string;

  /** Require Cmd (macOS) or Ctrl (Windows/Linux). Default false. */
  ctrlOrCmd?: boolean;

  /** Require Shift. Default false. */
  shift?: boolean;

  /** Require Alt / Option. Default false. */
  alt?: boolean;

  /**
   * If true, the shortcut still fires while focus is inside an input/textarea/select
   * or a contentEditable element. Cmd+S and Cmd+Shift+S use this — the "/" and "N"
   * shortcuts do not so the user can type them into a field.
   * Default false.
   */
  allowInInput?: boolean;

  /** Handler invoked when the shortcut matches. */
  handler: (event: KeyboardEvent) => void;
}

/**
 * KeyboardShortcutsService (FN-765)
 *
 * Global keyboard shortcut registry. Components register bindings in ngOnInit
 * and unregister in ngOnDestroy so only shortcuts for the active view are live.
 *
 * Usage:
 *   const off = this.shortcuts.register({
 *     id: 'loads.new',
 *     key: 'n',
 *     description: 'New load',
 *     group: 'Loads',
 *     handler: () => this.openLoadWizard(),
 *   });
 *   // ...in ngOnDestroy:
 *   off();
 *
 * Inspect active bindings (for the help modal) via `bindings$`, and toggle the
 * help overlay via `openHelp() / closeHelp()` / `helpOpen$`.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService implements OnDestroy {

  private readonly bindings = new Map<string, ShortcutBinding>();
  private readonly _bindings$ = new BehaviorSubject<ShortcutBinding[]>([]);
  private readonly _helpOpen$ = new BehaviorSubject<boolean>(false);
  private readonly listener: (e: KeyboardEvent) => void;

  constructor(private zone: NgZone) {
    this.listener = (e: KeyboardEvent) => this.handleKeydown(e);
    // Register outside Angular so idle keypresses don't trigger change detection.
    this.zone.runOutsideAngular(() => {
      window.addEventListener('keydown', this.listener, { capture: false });
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.listener);
  }

  /** Observable of currently registered bindings. */
  get bindings$(): Observable<ShortcutBinding[]> {
    return this._bindings$.asObservable();
  }

  /** Observable of help-modal visibility. */
  get helpOpen$(): Observable<boolean> {
    return this._helpOpen$.asObservable();
  }

  /**
   * Register a shortcut. Returns an unregister function so callers can simply
   * save the return value and invoke it in ngOnDestroy.
   */
  register(binding: ShortcutBinding): () => void {
    this.bindings.set(binding.id, binding);
    this._emit();
    return () => this.unregister(binding.id);
  }

  /** Register multiple bindings at once. Returns a single unregister-all function. */
  registerAll(bindings: ShortcutBinding[]): () => void {
    bindings.forEach(b => this.bindings.set(b.id, b));
    this._emit();
    return () => {
      bindings.forEach(b => this.bindings.delete(b.id));
      this._emit();
    };
  }

  unregister(id: string): void {
    if (this.bindings.delete(id)) { this._emit(); }
  }

  /** Current snapshot of bindings (ordered by insertion). */
  list(): ShortcutBinding[] {
    return [...this.bindings.values()];
  }

  openHelp(): void  { if (!this._helpOpen$.value) { this._helpOpen$.next(true); } }
  closeHelp(): void { if (this._helpOpen$.value)  { this._helpOpen$.next(false); } }
  toggleHelp(): void { this._helpOpen$.next(!this._helpOpen$.value); }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private _emit(): void {
    // Debounce-free: bindings only change on mount/unmount, not per keystroke.
    this._bindings$.next([...this.bindings.values()]);
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.bindings.size) { return; }

    const inInput = this.isTargetEditable(e.target);
    const eKey = (e.key || '').toLowerCase();
    const ctrlOrCmd = e.metaKey || e.ctrlKey;

    for (const binding of this.bindings.values()) {
      if (eKey !== binding.key.toLowerCase()) { continue; }
      if (!!binding.ctrlOrCmd !== ctrlOrCmd) { continue; }
      if (!!binding.shift !== e.shiftKey) { continue; }
      if (!!binding.alt !== e.altKey) { continue; }
      if (inInput && !binding.allowInInput) { continue; }

      // Run handler inside Angular zone so change detection picks up UI state changes.
      this.zone.run(() => {
        try { binding.handler(e); } catch { /* swallow; never break typing */ }
      });
      e.preventDefault();
      return;
    }
  }

  private isTargetEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) { return false; }
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') { return true; }
    if ((el as HTMLElement).isContentEditable) { return true; }
    return false;
  }

  // ─── Help-modal display helpers ─────────────────────────────────────────────

  /**
   * Build a human-readable keystroke label for UI display, e.g. "⌘S" on macOS,
   * "Ctrl+S" elsewhere. Uses a navigator check so tests and server environments
   * degrade gracefully.
   */
  static formatKey(b: ShortcutBinding): string {
    const parts: string[] = [];
    const mac = typeof navigator !== 'undefined'
      && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
    if (b.ctrlOrCmd) { parts.push(mac ? '⌘' : 'Ctrl'); }
    if (b.shift)     { parts.push(mac ? '⇧' : 'Shift'); }
    if (b.alt)       { parts.push(mac ? '⌥' : 'Alt'); }

    const key = b.key.length === 1 ? b.key.toUpperCase() : b.key;
    parts.push(key);

    return mac ? parts.join('') : parts.join('+');
  }
}
