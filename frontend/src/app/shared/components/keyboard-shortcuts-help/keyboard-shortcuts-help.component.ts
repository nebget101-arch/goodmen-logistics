import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { Subject, combineLatest } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  KeyboardShortcutsService,
  ShortcutBinding,
} from '../../services/keyboard-shortcuts.service';

interface ShortcutGroup {
  group: string;
  items: Array<{ keys: string; description: string }>;
}

/**
 * FN-765: Overlay modal that lists every currently-registered shortcut,
 * grouped by `ShortcutBinding.group`. Opens via the service (`openHelp()`)
 * or by pressing `?` globally.
 *
 * Placed once at app root (`app.component.html`) so any view can surface it.
 */
@Component({
  selector: 'app-keyboard-shortcuts-help',
  templateUrl: './keyboard-shortcuts-help.component.html',
  styleUrls: ['./keyboard-shortcuts-help.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyboardShortcutsHelpComponent implements OnInit, OnDestroy {

  open = false;
  groups: ShortcutGroup[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private shortcuts: KeyboardShortcutsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    // Register the "?" shortcut that opens this modal. Using the service means
    // the help modal itself shows up in its own list ("Show keyboard shortcuts").
    this.shortcuts.register({
      id: 'global.help',
      key: '?',
      shift: true, // "?" is produced by Shift+/ on US layouts — require it explicitly
      description: 'Show keyboard shortcuts',
      group: 'Global',
      handler: () => this.shortcuts.toggleHelp(),
    });

    combineLatest([this.shortcuts.helpOpen$, this.shortcuts.bindings$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([open, bindings]) => {
        this.open = open;
        this.groups = this.buildGroups(bindings);
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.shortcuts.unregister('global.help');
    this.destroy$.next();
    this.destroy$.complete();
  }

  close(): void {
    this.shortcuts.closeHelp();
  }

  // Close on backdrop click only — clicks inside the dialog must not close.
  onBackdropClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target?.classList?.contains('ksh-backdrop')) {
      this.close();
    }
  }

  // Esc on the overlay closes it without bubbling up to other Esc handlers.
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.open) {
      event.stopPropagation();
      event.preventDefault();
      this.close();
    }
  }

  /** Helper exposed to the template. */
  formatKey(b: ShortcutBinding): string {
    return KeyboardShortcutsService.formatKey(b);
  }

  private buildGroups(bindings: ShortcutBinding[]): ShortcutGroup[] {
    const map = new Map<string, ShortcutGroup>();
    for (const b of bindings) {
      const group = b.group || 'Other';
      if (!map.has(group)) { map.set(group, { group, items: [] }); }
      map.get(group)!.items.push({
        keys: KeyboardShortcutsService.formatKey(b),
        description: b.description,
      });
    }
    return [...map.values()];
  }
}
