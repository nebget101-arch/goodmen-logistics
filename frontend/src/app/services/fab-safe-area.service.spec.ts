/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { FabSafeAreaService } from './fab-safe-area.service';

describe('FabSafeAreaService (FN-1356)', () => {
  let svc: FabSafeAreaService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FabSafeAreaService);
    document.documentElement.style.removeProperty(FabSafeAreaService.CSS_VAR);
  });

  afterEach(() => {
    document.documentElement.style.removeProperty(FabSafeAreaService.CSS_VAR);
  });

  function readVar(): string {
    return document.documentElement.style.getPropertyValue(FabSafeAreaService.CSS_VAR);
  }

  it('does not set the var until a claim is registered', () => {
    expect(readVar()).toBe('');
  });

  it('publishes a single claim as Npx', () => {
    svc.register(64);
    expect(readVar()).toBe('64px');
  });

  it('publishes the maximum across multiple claims', () => {
    svc.register(48);
    svc.register(96);
    svc.register(64);
    expect(readVar()).toBe('96px');
  });

  it('falls back to the next-largest when the dominant claim is released', () => {
    const a = svc.register(48);
    const b = svc.register(96);
    expect(readVar()).toBe('96px');
    svc.release(b);
    expect(readVar()).toBe('48px');
    svc.release(a);
    expect(readVar()).toBe('');
  });

  it('update() recomputes the published value', () => {
    const handle = svc.register(64);
    svc.update(handle, 32);
    expect(readVar()).toBe('32px');
  });

  it('clamps negative values to 0', () => {
    svc.register(-10);
    expect(readVar()).toBe('0px');
  });
});
