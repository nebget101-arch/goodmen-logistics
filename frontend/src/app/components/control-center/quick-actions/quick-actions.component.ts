import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AccessControlService } from '../../../services/access-control.service';

/**
 * Definition of a contextual quick action embedded inside a Smart Alert
 * or Predictive Insight card. Up to 3 actions are surfaced per card; any
 * action whose `requiredPermission` is not satisfied by the current user
 * is filtered out client-side (the backend should still enforce on its
 * own routes — this is presentation-only gating).
 */
export interface QuickActionDef {
  /** Stable id used for `trackBy` and emitted with the `(action)` event. */
  id: string;
  label: string;
  /**
   * Optional single-character glyph rendered before the label. Kept as a
   * plain string (not an icon component) to match the lightweight glyph
   * style used by smart-alerts and predictive-insights.
   */
  icon?: string;
  /** Angular router commands array, e.g. `['/loads', '123']`. */
  routerLink?: (string | number)[];
  /** Query params merged with the `context` input on the consuming card. */
  queryParams?: Record<string, string | number | boolean>;
  /** Absolute URL for actions that open external flows. Mutually exclusive with `routerLink`. */
  href?: string;
  /**
   * Permission code(s) required to render the action. A string is treated
   * as a single permission; an array is satisfied when the user has ANY
   * of the listed permissions. Omit to render unconditionally.
   */
  requiredPermission?: string | string[];
  variant?: 'primary' | 'secondary';
}

export interface QuickActionEvent {
  action: QuickActionDef;
  /** Resolved query params (action defaults merged with the card-level context). */
  queryParams: Record<string, string | number | boolean>;
}

@Component({
  selector: 'app-quick-actions',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './quick-actions.component.html',
  styleUrls: ['./quick-actions.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickActionsComponent {
  /**
   * Card-level context (e.g. `{ loadId, driverId, vehicleId }`) merged into
   * each action's `queryParams` before navigation/emit. This lets the parent
   * card declare actions once and pass the row's identifiers in.
   */
  @Input() context: Record<string, string | number | boolean> = {};

  /** Optional accessible label, e.g. "Quick actions for load 4815". */
  @Input() ariaLabel: string | null = null;

  /** Maximum number of actions rendered. Defaults to 3 per AC. */
  @Input() max = 3;

  @Output() readonly action = new EventEmitter<QuickActionEvent>();

  private _actions: QuickActionDef[] = [];
  /** Pre-filtered list (permission-checked + capped to `max`). */
  visibleActions: QuickActionDef[] = [];

  constructor(private readonly access: AccessControlService) {}

  @Input() set actions(value: QuickActionDef[] | null | undefined) {
    this._actions = Array.isArray(value) ? value : [];
    this.visibleActions = this.filterAndCap(this._actions);
  }
  get actions(): QuickActionDef[] {
    return this._actions;
  }

  trackById(_index: number, item: QuickActionDef): string {
    return item.id;
  }

  resolveQueryParams(item: QuickActionDef): Record<string, string | number | boolean> {
    return { ...this.context, ...(item.queryParams || {}) };
  }

  onClick(item: QuickActionDef, event: Event): void {
    event.stopPropagation();
    this.action.emit({ action: item, queryParams: this.resolveQueryParams(item) });
  }

  private filterAndCap(list: QuickActionDef[]): QuickActionDef[] {
    const cap = Math.max(0, Math.min(this.max ?? 3, 3));
    return list.filter((a) => this.userCanSee(a)).slice(0, cap);
  }

  private userCanSee(item: QuickActionDef): boolean {
    const req = item.requiredPermission;
    if (!req) return true;
    if (Array.isArray(req)) {
      return req.length === 0 ? true : this.access.hasAnyPermission(req);
    }
    return this.access.hasPermission(req);
  }
}
