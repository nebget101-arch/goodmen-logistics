/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { WindowSelectorComponent } from './window-selector.component';
import {
  DashboardWindow,
  DashboardWindowService,
} from '../../../services/dashboard-window.service';

class FakeWindowService {
  private subject = new BehaviorSubject<DashboardWindow>('7d');
  setWindow = jasmine.createSpy('setWindow').and.callFake((w: DashboardWindow) => {
    this.subject.next(w);
  });
  current = (): DashboardWindow => this.subject.value;
  window$ = () => this.subject.asObservable();
  emit(w: DashboardWindow): void {
    this.subject.next(w);
  }
}

function setup() {
  TestBed.resetTestingModule();
  const fakeWindow = new FakeWindowService();
  TestBed.configureTestingModule({
    imports: [WindowSelectorComponent],
    providers: [{ provide: DashboardWindowService, useValue: fakeWindow }],
  });
  const fixture: ComponentFixture<WindowSelectorComponent> = TestBed.createComponent(WindowSelectorComponent);
  return { fixture, component: fixture.componentInstance, fakeWindow };
}

describe('WindowSelectorComponent', () => {
  it('marks the active window as aria-checked', fakeAsync(() => {
    const { fixture, fakeWindow } = setup();
    fakeWindow.emit('30d');
    fixture.detectChanges();
    tick();
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(3);
    const active = Array.from(buttons).find(
      (b: any) => b.getAttribute('aria-checked') === 'true',
    ) as HTMLElement;
    expect(active.getAttribute('data-window')).toBe('30d');
  }));

  it('calls setWindow on click', () => {
    const { fixture, fakeWindow } = setup();
    fixture.detectChanges();
    const today = fixture.nativeElement.querySelector('button[data-window="today"]') as HTMLElement;
    today.click();
    expect(fakeWindow.setWindow).toHaveBeenCalledWith('today');
  });

  it('updates active state when service emits a new window', fakeAsync(() => {
    const { fixture, component, fakeWindow } = setup();
    fixture.detectChanges();
    tick();
    fakeWindow.emit('today');
    tick();
    expect(component.active).toBe('today');
  }));
});
