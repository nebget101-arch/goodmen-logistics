import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';

import { AccessControlService } from '../../../services/access-control.service';
import {
  QuickActionDef,
  QuickActionEvent,
  QuickActionsComponent,
} from './quick-actions.component';

class FakeAccessControlService {
  private allow = new Set<string>();

  setPermissions(codes: string[]): void {
    this.allow = new Set(codes);
  }

  hasPermission(code: string): boolean {
    return this.allow.has(code);
  }

  hasAnyPermission(codes: string[]): boolean {
    return codes.some((c) => this.allow.has(c));
  }
}

describe('QuickActionsComponent', () => {
  let fixture: ComponentFixture<QuickActionsComponent>;
  let component: QuickActionsComponent;
  let access: FakeAccessControlService;

  const reassign: QuickActionDef = {
    id: 'reassign',
    label: 'Reassign load',
    icon: '↻',
    routerLink: ['/loads'],
    queryParams: { action: 'reassign' },
    requiredPermission: 'loads.edit',
  };
  const schedulePm: QuickActionDef = {
    id: 'schedule-pm',
    label: 'Schedule maintenance',
    routerLink: ['/work-orders', 'new'],
    requiredPermission: 'work_orders.create',
  };
  const notifyDriver: QuickActionDef = {
    id: 'notify-driver',
    label: 'Notify driver',
    requiredPermission: ['drivers.edit', 'drivers.manage'],
  };
  const fourthAction: QuickActionDef = {
    id: 'extra',
    label: 'Extra (over cap)',
  };

  beforeEach(async () => {
    access = new FakeAccessControlService();
    await TestBed.configureTestingModule({
      imports: [QuickActionsComponent],
      providers: [
        provideRouter([]),
        { provide: AccessControlService, useValue: access },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuickActionsComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when no actions provided', () => {
    component.actions = [];
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.quick-actions'))).toBeNull();
  });

  it('hides actions whose required permission is missing', () => {
    access.setPermissions(['loads.edit']); // not work_orders.create, not drivers.edit
    component.actions = [reassign, schedulePm, notifyDriver];
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('.quick-actions__btn'));
    expect(buttons.length).toBe(1);
    expect(buttons[0].nativeElement.textContent).toContain('Reassign load');
  });

  it('shows action when ANY permission in the array is granted', () => {
    access.setPermissions(['drivers.manage']); // satisfies notifyDriver's array
    component.actions = [notifyDriver];
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.quick-actions__btn')).length).toBe(1);
  });

  it('caps the visible list at 3 (or the configured max)', () => {
    access.setPermissions(['loads.edit', 'work_orders.create', 'drivers.edit']);
    component.actions = [reassign, schedulePm, notifyDriver, fourthAction];
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.quick-actions__btn')).length).toBe(3);
  });

  it('emits (action) with merged context queryParams when clicked', () => {
    access.setPermissions(['loads.edit']);
    component.context = { loadId: 'load-42' };
    component.actions = [reassign];
    fixture.detectChanges();

    let captured: QuickActionEvent | null = null;
    component.action.subscribe((e) => (captured = e));

    const link = fixture.debugElement.query(By.css('.quick-actions__btn'));
    link.triggerEventHandler('click', new MouseEvent('click'));

    expect(captured).not.toBeNull();
    expect(captured!.action.id).toBe('reassign');
    expect(captured!.queryParams).toEqual({ loadId: 'load-42', action: 'reassign' });
  });

  it('renders an unconditional action (no requiredPermission) for any user', () => {
    access.setPermissions([]);
    component.actions = [{ id: 'view', label: 'Open', routerLink: ['/somewhere'] }];
    fixture.detectChanges();

    expect(fixture.debugElement.queryAll(By.css('.quick-actions__btn')).length).toBe(1);
  });
});
