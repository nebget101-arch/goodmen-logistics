import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, of, throwError } from 'rxjs';

import { BarcodeScannerDialogComponent } from './barcode-scanner-dialog.component';
import { ApiService } from '../../../services/api.service';

/**
 * FN-1107 unit specs — the shared barcode-scanner dialog. The
 * parts-catalog spec covers the lookup-routing logic; this spec covers
 * the dialog's local behavior: image decode (success, malformed, error),
 * manual entry guard, and the close lifecycle.
 */
class ApiServiceStub {
  decodeBarcodeFromImage = jasmine.createSpy('decodeBarcodeFromImage');
  createScanBridgeSession(): Observable<any> { return of({ data: {} }); }
  getBaseUrl(): string { return ''; }
}

function makeImage(): File {
  return new File([new Uint8Array([1, 2, 3])], 'barcode.jpg', { type: 'image/jpeg' });
}

describe('BarcodeScannerDialogComponent', () => {
  let fixture: ComponentFixture<BarcodeScannerDialogComponent>;
  let component: BarcodeScannerDialogComponent;
  let api: ApiServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [BarcodeScannerDialogComponent],
      providers: [{ provide: ApiService, useClass: ApiServiceStub }],
    }).compileComponents();

    fixture = TestBed.createComponent(BarcodeScannerDialogComponent);
    component = fixture.componentInstance;
    api = TestBed.inject(ApiService) as unknown as ApiServiceStub;
    fixture.detectChanges();
  });

  describe('image decode', () => {
    it('emits the decoded barcode when the API returns a value', () => {
      const emitted: string[] = [];
      component.scanned.subscribe((c) => emitted.push(c));
      api.decodeBarcodeFromImage.and.returnValue(of({ success: true, data: { barcode: 'BC-OK', format: 'CODE128' } }));

      const input = { value: 'set', files: [makeImage()] } as unknown as HTMLInputElement;
      component.onDecodeImage({ target: input } as unknown as Event);

      expect(api.decodeBarcodeFromImage).toHaveBeenCalled();
      expect(emitted).toEqual(['BC-OK']);
      expect(component.toast).toBe('');
      expect(component.decoding).toBe(false);
      // Input value reset so the same file can be picked again.
      expect(input.value).toBe('');
    });

    it('shows a toast and stays open when the API returns barcode=null (malformed)', () => {
      const emitted: string[] = [];
      component.scanned.subscribe((c) => emitted.push(c));
      api.decodeBarcodeFromImage.and.returnValue(of({ success: true, data: { barcode: null, format: null } }));

      component.onDecodeImage({ target: { value: '', files: [makeImage()] } } as unknown as Event);

      expect(emitted.length).toBe(0);
      expect(component.toast).toMatch(/no barcode/i);
      expect(component.decoding).toBe(false);
    });

    it('shows a toast on API error', () => {
      api.decodeBarcodeFromImage.and.returnValue(throwError(() => ({ message: 'network down' })));

      component.onDecodeImage({ target: { value: '', files: [makeImage()] } } as unknown as Event);

      expect(component.toast).toContain('network down');
      expect(component.decoding).toBe(false);
    });

    it('does nothing when no file is selected', () => {
      component.onDecodeImage({ target: { files: [] } } as unknown as Event);
      expect(api.decodeBarcodeFromImage).not.toHaveBeenCalled();
    });
  });

  describe('manual entry', () => {
    it('emits the trimmed value', () => {
      const emitted: string[] = [];
      component.scanned.subscribe((c) => emitted.push(c));
      component.manualValue = '  BARCODE-7  ';

      component.submitManual();

      expect(emitted).toEqual(['BARCODE-7']);
      expect(component.toast).toBe('');
    });

    it('shows a toast and does not emit when the value is blank', () => {
      const emitted: string[] = [];
      component.scanned.subscribe((c) => emitted.push(c));
      component.manualValue = '   ';

      component.submitManual();

      expect(emitted.length).toBe(0);
      expect(component.toast).toMatch(/enter/i);
    });
  });

  describe('close', () => {
    it('emits closed and stops any phone bridge', () => {
      const closedSpy = jasmine.createSpy('closed');
      component.closed.subscribe(closedSpy);
      const stopSpy = spyOn(component, 'stopPhoneBridge').and.callThrough();

      component.close();

      expect(stopSpy).toHaveBeenCalled();
      expect(closedSpy).toHaveBeenCalled();
    });
  });
});
