/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { Subject, throwError } from 'rxjs';

import { InvoiceUploadCardComponent } from './invoice-upload-card.component';
import {
  ApiService,
  InvoiceUploadEvent,
  InvoiceUploadResult
} from '../../services/api.service';

function makeFile(name = 'invoice.png', type = 'image/png', size = 1024): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe('InvoiceUploadCardComponent (FN-1491)', () => {
  let fixture: ComponentFixture<InvoiceUploadCardComponent>;
  let component: InvoiceUploadCardComponent;
  let api: jasmine.SpyObj<ApiService>;
  let upload$: Subject<InvoiceUploadEvent>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['uploadReceivingInvoice']);
    upload$ = new Subject<InvoiceUploadEvent>();
    api.uploadReceivingInvoice.and.returnValue(upload$.asObservable());

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [InvoiceUploadCardComponent],
      providers: [{ provide: ApiService, useValue: api }]
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceUploadCardComponent);
    component = fixture.componentInstance;
    component.ticketId = 'tkt-1';
    fixture.detectChanges();
  });

  it('shows the empty drop-zone when no upload has happened', () => {
    const button = fixture.nativeElement.querySelector('.iuc__dropzone');
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('Drop file or click to upload');
  });

  it('emits uploadStart and updates progress while uploading; emits extracted on success', () => {
    const startSpy = jasmine.createSpy('start');
    const extractedSpy = jasmine.createSpy('extracted');
    const errorSpy = jasmine.createSpy('error');
    component.uploadStart.subscribe(startSpy);
    component.extracted.subscribe(extractedSpy);
    component.uploadError.subscribe(errorSpy);

    const file = makeFile();
    (component as any).startUpload(file);

    expect(api.uploadReceivingInvoice).toHaveBeenCalledWith('tkt-1', file);
    expect(component.uploading).toBeTrue();
    expect(startSpy).toHaveBeenCalled();

    upload$.next({ kind: 'progress', progress: 47 });
    expect(component.progress).toBe(47);

    const result: InvoiceUploadResult = {
      fileUrl: 'https://r2/x.png',
      extracted: { vendor: 'Acme', reference: 'PO-1', lines: [] }
    };
    upload$.next({ kind: 'result', result });
    upload$.complete();

    expect(component.uploading).toBeFalse();
    expect(component.hasResult).toBeTrue();
    expect(component.progress).toBe(100);
    expect(extractedSpy).toHaveBeenCalledWith(result);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('surfaces upload errors with retry CTA and emits uploadError', () => {
    const errorSpy = jasmine.createSpy('error');
    component.uploadError.subscribe(errorSpy);

    api.uploadReceivingInvoice.and.returnValue(
      throwError(() => ({ error: { error: 'AI service unavailable' } }))
    );

    (component as any).startUpload(makeFile());
    fixture.detectChanges();

    expect(component.uploading).toBeFalse();
    expect(component.errorMsg).toBe('AI service unavailable');
    expect(errorSpy).toHaveBeenCalledWith('AI service unavailable');

    const errorBlock = fixture.nativeElement.querySelector('.iuc__error');
    expect(errorBlock).toBeTruthy();
    expect(errorBlock.textContent).toContain('AI service unavailable');
    const retryBtn = fixture.nativeElement.querySelector('.iuc__retry') as HTMLButtonElement;
    expect(retryBtn).toBeTruthy();
    expect(retryBtn.disabled).toBeFalse();
  });

  it('rejects oversized files without calling the API', () => {
    const big = makeFile('big.png', 'image/png', 16 * 1024 * 1024);
    (component as any).startUpload(big);
    expect(api.uploadReceivingInvoice).not.toHaveBeenCalled();
    expect(component.errorMsg).toContain('File too large');
  });

  it('rejects unsupported file types without calling the API', () => {
    const bad = makeFile('thing.txt', 'text/plain', 100);
    (component as any).startUpload(bad);
    expect(api.uploadReceivingInvoice).not.toHaveBeenCalled();
    expect(component.errorMsg).toContain('Unsupported file type');
  });

  it('drops files via dataTransfer trigger startUpload', () => {
    const file = makeFile();
    const dt = { files: [file] } as unknown as DataTransfer;
    const event = new DragEvent('drop');
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    spyOn(event, 'preventDefault');
    spyOn(event, 'stopPropagation');

    component.onDrop(event as DragEvent);

    expect(api.uploadReceivingInvoice).toHaveBeenCalledWith('tkt-1', file);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('handles paste-from-clipboard images', () => {
    const file = makeFile('clip.png');
    const event = {
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => file }]
      },
      preventDefault: jasmine.createSpy('preventDefault')
    } as unknown as ClipboardEvent;

    component.onPaste(event);

    expect(api.uploadReceivingInvoice).toHaveBeenCalledWith('tkt-1', file);
    expect((event as any).preventDefault).toHaveBeenCalled();
  });

  it('disables interactions when no ticket is open', () => {
    component.ticketId = null;
    fixture.detectChanges();
    expect(component.canInteract).toBeFalse();

    const file = makeFile();
    (component as any).startUpload(file);
    expect(api.uploadReceivingInvoice).not.toHaveBeenCalled();
    expect(component.errorMsg).toContain('No active receiving ticket');
  });
});
