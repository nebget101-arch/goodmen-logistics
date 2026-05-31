import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ElementRef,
  AfterContentInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

export interface RailTab {
  key: string;
  label: string;
  icon?: string;
}

/**
 * Underlined tab strip with projected content panes. Consumers slot panes via
 * `[data-rail-pane="<key>"]`; the component shows only the pane whose key equals
 * `activeKey`. Two-way friendly via `[(activeKey)]`. Declared + exported from
 * `SharedModule`.
 */
@Component({
  selector: 'app-side-rail-tabs',
  templateUrl: './side-rail-tabs.component.html',
  styleUrls: ['./side-rail-tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideRailTabsComponent implements AfterContentInit, OnChanges {
  @Input() tabs: RailTab[] = [];
  @Input() activeKey = '';

  @Output() activeKeyChange = new EventEmitter<string>();

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngAfterContentInit(): void {
    this.syncPanes();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activeKey']) {
      this.syncPanes();
    }
  }

  trackByKey(_index: number, tab: RailTab): string {
    return tab.key;
  }

  select(key: string): void {
    if (key === this.activeKey) {
      return;
    }
    this.activeKey = key;
    this.activeKeyChange.emit(key);
    this.syncPanes();
  }

  /** Show only the projected pane whose data-rail-pane matches activeKey. */
  private syncPanes(): void {
    const panes = this.host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-rail-pane]'
    );
    panes.forEach((pane) => {
      const key = pane.getAttribute('data-rail-pane');
      pane.style.display = key === this.activeKey ? '' : 'none';
    });
  }
}
