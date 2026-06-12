import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-driver-portal-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  templateUrl: './shell.component.html',
  styleUrls: ['./shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DriverPortalShellComponent {
  readonly navItems = [
    { path: 'incidents', label: 'Incidents', icon: 'warning' },
  ] as const;
}
