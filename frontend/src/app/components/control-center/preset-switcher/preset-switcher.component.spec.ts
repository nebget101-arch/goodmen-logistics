/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { PresetSwitcherComponent } from './preset-switcher.component';
import { DashboardLayoutService } from '../../../services/dashboard-layout.service';
import { LAYOUT_PRESETS } from '../role-layouts';
import { environment } from '../../../../environments/environment';

const layoutEndpoint = `${environment.apiUrl}/users/me/dashboard-layout`;

function setup(): {
  fixture: ComponentFixture<PresetSwitcherComponent>;
  component: PresetSwitcherComponent;
  httpMock: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule, NoopAnimationsModule, PresetSwitcherComponent],
    providers: [DashboardLayoutService],
  });
  const fixture = TestBed.createComponent(PresetSwitcherComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, component, httpMock };
}

describe('PresetSwitcherComponent', () => {
  it('loads the canonical three presets on init', fakeAsync(() => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    tick();
    expect(component.loadingPresets).toBeFalse();
    expect(component.presets.map((p) => p.presetKey)).toEqual([
      'owner-default',
      'dispatcher-default',
      'compliance-default',
    ]);
  }));

  it('starts closed and toggles open on trigger', fakeAsync(() => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    tick();
    expect(component.open).toBeFalse();
    component.toggle();
    expect(component.open).toBeTrue();
    component.toggle();
    expect(component.open).toBeFalse();
  }));

  it('disables trigger when [disabled]=true', fakeAsync(() => {
    const { fixture, component } = setup();
    component.disabled = true;
    fixture.detectChanges();
    tick();
    component.toggle();
    expect(component.open).toBeFalse();
  }));

  it('seeds selectedKey from activePresetKey when opened', fakeAsync(() => {
    const { fixture, component } = setup();
    component.activePresetKey = 'dispatcher-default';
    fixture.detectChanges();
    tick();
    component.toggle();
    expect(component.selectedKey).toBe('dispatcher-default');
  }));

  it('apply() PUTs the selected preset layout and emits presetApplied', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();

    const emitted: unknown[] = [];
    component.presetApplied.subscribe((v) => emitted.push(v));

    component.toggle();
    component.select('compliance-default');
    component.apply();

    const req = httpMock.expectOne(layoutEndpoint);
    expect(req.request.method).toBe('PUT');
    const compliancePreset = LAYOUT_PRESETS.find((p) => p.presetKey === 'compliance-default')!;
    expect(req.request.body).toEqual({ cards: [...compliancePreset.widgets] });
    req.flush({
      success: true,
      data: {
        layout: { cards: [...compliancePreset.widgets] },
        is_default: false,
        role: 'safety',
        updated_at: '2026-05-05T00:00:00.000Z',
      },
    });
    tick();

    expect(component.applying).toBeFalse();
    expect(component.open).toBeFalse();
    expect(emitted.length).toBe(1);
    httpMock.verify();
  }));

  it('emits presetApplyFailed on PUT error', fakeAsync(() => {
    const { fixture, component, httpMock } = setup();
    fixture.detectChanges();
    tick();

    const errors: string[] = [];
    component.presetApplyFailed.subscribe((m) => errors.push(m));

    component.toggle();
    component.select('owner-default');
    component.apply();

    httpMock.expectOne(layoutEndpoint).flush(
      { error: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    tick();

    expect(errors.length).toBe(1);
    expect(component.applying).toBeFalse();
    httpMock.verify();
  }));

  it('confirm button is disabled when no preset is selected', fakeAsync(() => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    tick();
    component.toggle();
    expect(component.selectedKey).toBeNull();
    component.apply(); // no-op
    expect(component.applying).toBeFalse();
  }));

  it('escape key closes the open panel', fakeAsync(() => {
    const { fixture, component } = setup();
    fixture.detectChanges();
    tick();
    component.toggle();
    expect(component.open).toBeTrue();
    component.onEscape();
    expect(component.open).toBeFalse();
  }));
});
