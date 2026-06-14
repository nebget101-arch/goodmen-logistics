/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { SignatureCaptureComponent, SignatureValue } from './signature-capture.component';

describe('SignatureCaptureComponent', () => {
  let fixture: ComponentFixture<SignatureCaptureComponent>;
  let component: SignatureCaptureComponent;
  let emitted: (SignatureValue | null)[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SignatureCaptureComponent],
    }).overrideComponent(SignatureCaptureComponent, {
      // Bypass the real template so we don't need a live <canvas> in the unit test.
      set: { template: '<div></div>' },
    });

    fixture = TestBed.createComponent(SignatureCaptureComponent);
    component = fixture.componentInstance;
    emitted = [];
    component.signatureChange.subscribe(v => emitted.push(v));
  });

  function changeName(name: string): void {
    component.typedName = name;
    component.ngOnChanges({
      typedName: new SimpleChange(undefined, name, false),
    });
  }

  it('defaults to typed mode', () => {
    expect(component.mode).toBe('typed');
  });

  it('emits the typed name as a typed signature when the name changes', () => {
    changeName('Jordan Rivera');
    expect(emitted.pop()).toEqual({ value: 'Jordan Rivera', type: 'typed' });
  });

  it('emits null while the typed name is blank', () => {
    changeName('   ');
    expect(emitted.pop()).toBeNull();
  });

  it('does not emit on name change while in drawn mode', () => {
    component.setMode('drawn');
    emitted = [];
    component.ngOnChanges({ typedName: new SimpleChange('', 'Sam', false) });
    expect(emitted.length).toBe(0);
  });

  it('switching back to typed re-emits the current name', () => {
    component.typedName = 'Pat Lee';
    component.setMode('drawn');
    emitted = [];
    component.setMode('typed');
    expect(emitted.pop()).toEqual({ value: 'Pat Lee', type: 'typed' });
  });

  it('clear() resets the drawing and emits null', () => {
    component.setMode('drawn');
    component.hasDrawing = true;
    emitted = [];
    component.clear();
    expect(component.hasDrawing).toBeFalse();
    expect(emitted.pop()).toBeNull();
  });

  it('ignores mode changes while disabled', () => {
    component.disabled = true;
    component.setMode('drawn');
    expect(component.mode).toBe('typed');
  });
});
