/// <reference types="jasmine" />

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { Location } from '@angular/common';

import {
  DashboardWindowService,
  DEFAULT_DASHBOARD_WINDOW,
} from './dashboard-window.service';

@Component({ standalone: true, template: '' })
class StubPageComponent {}

function setup(initialUrl: string) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: StubPageComponent },
        { path: '**', component: StubPageComponent },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  const location = TestBed.inject(Location);
  return { router, location };
}

describe('DashboardWindowService', () => {
  it('defaults to 7d when URL has no ?window=', fakeAsync(() => {
    const { router } = setup('/');
    void router.navigateByUrl('/');
    tick();
    const svc = TestBed.inject(DashboardWindowService);
    expect(svc.current()).toBe(DEFAULT_DASHBOARD_WINDOW);
  }));

  it('reads ?window= from URL on init', fakeAsync(() => {
    const { router } = setup('/?window=30d');
    void router.navigateByUrl('/?window=30d');
    tick();
    const svc = TestBed.inject(DashboardWindowService);
    expect(svc.current()).toBe('30d');
  }));

  it('ignores unknown ?window= values and falls back to default', fakeAsync(() => {
    const { router } = setup('/?window=lifetime');
    void router.navigateByUrl('/?window=lifetime');
    tick();
    const svc = TestBed.inject(DashboardWindowService);
    expect(svc.current()).toBe(DEFAULT_DASHBOARD_WINDOW);
  }));

  it('setWindow updates the URL ?window= and emits new value', fakeAsync(() => {
    const { router, location } = setup('/');
    void router.navigateByUrl('/');
    tick();
    const svc = TestBed.inject(DashboardWindowService);

    const seen: string[] = [];
    svc.window$().subscribe((w) => seen.push(w));

    svc.setWindow('today');
    tick();
    expect(svc.current()).toBe('today');
    expect(location.path()).toContain('window=today');
    expect(seen).toContain('today');
  }));

  it('setWindow is a no-op when value is unchanged', fakeAsync(() => {
    const { router } = setup('/?window=7d');
    void router.navigateByUrl('/?window=7d');
    tick();
    const svc = TestBed.inject(DashboardWindowService);

    const seen: string[] = [];
    svc.window$().subscribe((w) => seen.push(w));
    seen.length = 0;

    svc.setWindow('7d');
    tick();
    expect(seen.length).toBe(0);
  }));
});
