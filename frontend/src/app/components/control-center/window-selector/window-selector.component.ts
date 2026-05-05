import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DASHBOARD_WINDOWS,
  DashboardWindow,
  DashboardWindowService,
} from '../../../services/dashboard-window.service';

interface WindowOption {
  value: DashboardWindow;
  label: string;
  ariaLabel: string;
}

const OPTIONS: readonly WindowOption[] = [
  { value: 'today', label: 'Today', ariaLabel: 'Today window' },
  { value: '7d', label: '7d', ariaLabel: 'Last 7 days window' },
  { value: '30d', label: '30d', ariaLabel: 'Last 30 days window' },
];

@Component({
  selector: 'app-window-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './window-selector.component.html',
  styleUrls: ['./window-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WindowSelectorComponent implements OnInit {
  readonly options = OPTIONS;
  readonly windowKeys = DASHBOARD_WINDOWS;
  active: DashboardWindow;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly windowService: DashboardWindowService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.active = this.windowService.current();
  }

  ngOnInit(): void {
    this.windowService
      .window$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((w) => {
        this.active = w;
        this.cdr.markForCheck();
      });
  }

  select(value: DashboardWindow): void {
    this.windowService.setWindow(value);
  }

  trackByValue = (_: number, opt: WindowOption): string => opt.value;
}
