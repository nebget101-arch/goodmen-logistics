import { Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AccessControlService } from '../services/access-control.service';

/**
 * Structural directive: *appHasPermission="'work_orders.create'"
 * Renders the template only if the user has the given permission.
 */
@Directive({ selector: '[appHasPermission]' })
export class HasPermissionDirective {
  private hasView = false;

  @Input() set appHasPermission(permission: string | null | undefined) {
    const allowed = this.access.hasPermission(permission ?? '');
    if (allowed && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!allowed && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private access: AccessControlService
  ) {}
}

/**
 * Structural directive: *appHasAnyPermission="['work_orders.create','work_orders.edit']"
 * Renders the template only if the user has at least one of the given permissions.
 */
@Directive({ selector: '[appHasAnyPermission]' })
export class HasAnyPermissionDirective {
  private hasView = false;

  @Input() set appHasAnyPermission(permissions: string[] | null | undefined) {
    const list = Array.isArray(permissions) ? permissions : [];
    const allowed = this.access.hasAnyPermission(list);
    if (allowed && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!allowed && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private access: AccessControlService
  ) {}
}
