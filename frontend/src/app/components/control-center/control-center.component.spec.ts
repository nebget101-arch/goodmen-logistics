/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { ControlCenterComponent } from './control-center.component';
import { DashboardLayoutService } from '../../services/dashboard-layout.service';
import { ROLE_DEFAULT_LAYOUTS, WidgetId } from './role-layouts';
import { environment } from '../../../environments/environment';

@Component({ selector: 'app-daily-briefing', standalone: true, template: '' })
class StubDailyBriefingComponent {}
@Component({ selector: 'app-action-queue', standalone: true, template: '' })
class StubActionQueueComponent {}
@Component({ selector: 'app-predictive-insights', standalone: true, template: '' })
class StubPredictiveInsightsComponent {}
@Component({
  selector: 'app-quick-actions',
  standalone: true,
  template: '',
  inputs: ['actions', 'ariaLabel', 'context', 'max'],
})
class StubQuickActionsComponent {}

const layoutEndpoint = `${environment.apiUrl}/users/me/dashboard-layout`;

function envelope(role: string, cards: WidgetId[], isDefault: boolean, hidden: WidgetId[] = []) {
  return {
    success: true,
    data: {
      layout: { cards, hidden },
      is_default: isDefault,
      role,
      updated_at: isDefault ? null : '2026-05-04T12:00:00.000Z',
    },
  };
}

function setup(): {
  fixture: ComponentFixture<ControlCenterComponent>;
  component: ControlCenterComponent;
  httpMock: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule, NoopAnimationsModule, ControlCenterComponent],
    providers: [DashboardLayoutService],
  });
  TestBed.overrideComponent(ControlCenterComponent, {
    set: {
      imports: [
        CommonModule,
        DragDropModule,
        StubDailyBriefingComponent,
        StubActionQueueComponent,
        StubPredictiveInsightsComponent,
        StubQuickActionsComponent,
      ],
    },
  });
  const fixture = TestBed.createComponent(ControlCenterComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component, httpMock };
}

describe('ControlCenterComponent', () => {
  it('uses the role default returned by GET when is_default=true', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();
    expect(component.role).toBe('dispatcher');
    expect(component.widgets).toEqual([...ROLE_DEFAULT_LAYOUTS.dispatcher]);
    expect(component.loading).toBeFalse();
    httpMock.verify();
  }));

  (['safety', 'maintenance', 'owner'] as const).forEach((role) => {
    it(`renders role default for ${role}`, fakeAsync(() => {
      const { fixture, component, httpMock } = setup();
      fixture.detectChanges();
      tick();
      httpMock
        .expectOne(layoutEndpoint)
        .flush(envelope(role, [...ROLE_DEFAULT_LAYOUTS[role]], true));
      tick();
      expect(component.role).toBe(role);
      expect(component.widgets).toEqual([...ROLE_DEFAULT_LAYOUTS[role]]);
      httpMock.verify();
    }));
  });

  it('normalizes BE role aliases to canonical FE keys', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('admin', [...ROLE_DEFAULT_LAYOUTS.owner], true));
    tick();
    expect(component.role).toBe('owner');
    httpMock.verify();
  }));

  it('uses saved layout, sanitizes unknown ids, and migrates legacy smart-alerts → action-queue', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock.expectOne(layoutEndpoint).flush(
      envelope(
        'dispatcher',
        ['quick-actions', 'unknown' as WidgetId, 'smart-alerts' as unknown as WidgetId, 'daily-briefing'],
        false,
      ),
    );
    tick();
    expect(component.widgets).toEqual([
      'quick-actions',
      'action-queue',
      'daily-briefing',
    ] as WidgetId[]);
    httpMock.verify();
  }));

  it('PUTs new order with body { cards } after onDrop', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();

    component.onDrop({ previousIndex: 0, currentIndex: 2 } as any);
    expect(component.widgets[0]).toBe('predictive-insights');

    const put = httpMock.expectOne(layoutEndpoint);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ cards: component.widgets, hidden: [] });
    put.flush(envelope('dispatcher', [...component.widgets], false));
    tick();
    expect(component.saving).toBeFalse();
    httpMock.verify();
  }));

  it('does not call PUT when drop position is unchanged', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();

    component.onDrop({ previousIndex: 1, currentIndex: 1 } as any);
    httpMock.expectNone(layoutEndpoint);
    httpMock.verify();
  }));

  it('resetToDefault calls DELETE and applies the returned default', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('safety', ['quick-actions', 'action-queue'] as WidgetId[], false));
    tick();

    expect(component.widgets).toEqual([
      'quick-actions',
      'action-queue',
    ] as WidgetId[]);

    component.resetToDefault();
    const del = httpMock.expectOne(layoutEndpoint);
    expect(del.request.method).toBe('DELETE');
    del.flush(envelope('safety', [...ROLE_DEFAULT_LAYOUTS.safety], true));
    tick();

    expect(component.widgets).toEqual([...ROLE_DEFAULT_LAYOUTS.safety]);
    expect(component.errorMessage).toBeNull();
    httpMock.verify();
  }));

  it('falls back to client role default when GET fails', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    tick();
    expect(component.widgets).toEqual([...ROLE_DEFAULT_LAYOUTS.dispatcher]);
    expect(component.errorMessage).toContain('Could not load');
    httpMock.verify();
  }));

  it('shows an error when save fails', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();

    component.onDrop({ previousIndex: 0, currentIndex: 1 } as any);
    httpMock
      .expectOne(layoutEndpoint)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    tick();

    expect(component.errorMessage).toContain('Could not save');
    httpMock.verify();
  }));

  it('hydrates persisted hidden cards and excludes them from visibleWidgets', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(
        envelope(
          'dispatcher',
          [...ROLE_DEFAULT_LAYOUTS.dispatcher],
          false,
          ['daily-briefing'] as WidgetId[],
        ),
      );
    tick();

    expect(component.hidden).toEqual(['daily-briefing'] as WidgetId[]);
    expect(component.visibleWidgets).not.toContain('daily-briefing' as WidgetId);
    expect(component.visibleWidgets.length).toBe(component.widgets.length - 1);
    httpMock.verify();
  }));

  it('persists newly hidden card when a child reports hasBaseline=false', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();

    component.onBriefingVisibility({ hasBaseline: false, firstBaselineEta: '2026-05-12' });
    expect(component.hidden).toEqual(['daily-briefing'] as WidgetId[]);

    const put = httpMock.expectOne(layoutEndpoint);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      cards: component.widgets,
      hidden: ['daily-briefing'],
    });
    put.flush(
      envelope('dispatcher', [...component.widgets], false, ['daily-briefing'] as WidgetId[]),
    );
    tick();
    httpMock.verify();
  }));

  it('un-hides a card when the child later reports hasBaseline=true', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(
        envelope(
          'dispatcher',
          [...ROLE_DEFAULT_LAYOUTS.dispatcher],
          false,
          ['predictive-insights'] as WidgetId[],
        ),
      );
    tick();

    component.onInsightsVisibility({ hasBaseline: true, firstBaselineEta: null });
    expect(component.hidden).toEqual([]);

    const put = httpMock.expectOne(layoutEndpoint);
    expect(put.request.body).toEqual({ cards: component.widgets, hidden: [] });
    put.flush(envelope('dispatcher', [...component.widgets], false));
    tick();
    httpMock.verify();
  }));

  it('toggleShowHidden surfaces dismissed cards without persisting', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(
        envelope(
          'dispatcher',
          [...ROLE_DEFAULT_LAYOUTS.dispatcher],
          false,
          ['daily-briefing'] as WidgetId[],
        ),
      );
    tick();

    expect(component.visibleWidgets).not.toContain('daily-briefing' as WidgetId);
    component.toggleShowHidden();
    expect(component.showHidden).toBeTrue();
    expect(component.visibleWidgets).toContain('daily-briefing' as WidgetId);
    httpMock.expectNone(layoutEndpoint);
    httpMock.verify();
  }));

  it('shows an error when reset fails', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();
    httpMock
      .expectOne(layoutEndpoint)
      .flush(envelope('dispatcher', [...ROLE_DEFAULT_LAYOUTS.dispatcher], true));
    tick();

    component.resetToDefault();
    httpMock
      .expectOne(layoutEndpoint)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    tick();

    expect(component.errorMessage).toContain('Could not reset');
    httpMock.verify();
  }));
});
