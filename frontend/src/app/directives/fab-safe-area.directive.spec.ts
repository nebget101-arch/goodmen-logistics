/// <reference types="jasmine" />

import { Component } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FabSafeAreaDirective } from './fab-safe-area.directive';
import { FabSafeAreaService } from '../services/fab-safe-area.service';

@Component({
  standalone: true,
  imports: [FabSafeAreaDirective],
  template: `
    <div *ngIf="show" class="paginator" [appFabSafeArea]="value">paginator</div>
  `,
})
class HostComponent {
  show = true;
  value: number | string = 64;
}

describe('FabSafeAreaDirective (FN-1356)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    document.documentElement.style.removeProperty(FabSafeAreaService.CSS_VAR);
    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    document.documentElement.style.removeProperty(FabSafeAreaService.CSS_VAR);
  });

  function readVar(): string {
    return document.documentElement.style.getPropertyValue(FabSafeAreaService.CSS_VAR);
  }

  it('publishes the configured value on attach', () => {
    fixture.detectChanges();
    expect(readVar()).toBe('64px');
  });

  it('updates the var when the input changes', () => {
    fixture.detectChanges();
    fixture.componentInstance.value = 96;
    fixture.detectChanges();
    expect(readVar()).toBe('96px');
  });

  it('parses string values like "48"', () => {
    fixture.componentInstance.value = '48';
    fixture.detectChanges();
    expect(readVar()).toBe('48px');
  });

  it('clears the var when the host element is destroyed', () => {
    fixture.detectChanges();
    expect(readVar()).toBe('64px');
    fixture.componentInstance.show = false;
    fixture.detectChanges();
    expect(readVar()).toBe('');
  });
});
