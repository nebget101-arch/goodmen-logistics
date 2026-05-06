/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { AiChatLauncherService } from './ai-chat-launcher.service';

describe('AiChatLauncherService (FN-1356)', () => {
  const STORAGE_KEY = 'neuronFabState';
  const MOBILE_QUERY = '(max-width: 639px)';

  let originalMatchMedia: typeof window.matchMedia;
  let mediaMatches: boolean;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    originalMatchMedia = window.matchMedia;
    mediaMatches = false;
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      matches: query === MOBILE_QUERY ? mediaMatches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }) as MediaQueryList);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  function freshService(): AiChatLauncherService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(AiChatLauncherService);
  }

  it('defaults to "default" on desktop when no preference is persisted', () => {
    mediaMatches = false;
    expect(freshService().state).toBe('default');
  });

  it('defaults to "minimized" on mobile when no preference is persisted', () => {
    mediaMatches = true;
    expect(freshService().state).toBe('minimized');
  });

  it('honors a persisted preference even on mobile', () => {
    mediaMatches = true;
    localStorage.setItem(STORAGE_KEY, 'default');
    expect(freshService().state).toBe('default');
  });

  it('honors a persisted preference even on desktop', () => {
    mediaMatches = false;
    localStorage.setItem(STORAGE_KEY, 'minimized');
    expect(freshService().state).toBe('minimized');
  });

  it('persists state on setState and emits via state$', () => {
    const svc = freshService();
    const observed: string[] = [];
    svc.state$.subscribe((s) => observed.push(s));

    svc.setState('minimized');
    expect(svc.state).toBe('minimized');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('minimized');
    expect(observed).toEqual(['default', 'minimized']);
  });

  it('toggle() flips between default and minimized and persists each step', () => {
    const svc = freshService();
    expect(svc.state).toBe('default');
    svc.toggle();
    expect(svc.state).toBe('minimized');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('minimized');
    svc.toggle();
    expect(svc.state).toBe('default');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('default');
  });

  it('ignores junk values in localStorage and falls back to mobile/desktop default', () => {
    mediaMatches = false;
    localStorage.setItem(STORAGE_KEY, 'expanded-pls');
    expect(freshService().state).toBe('default');
  });
});
