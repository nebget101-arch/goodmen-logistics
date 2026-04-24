/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { LoadWizardAttachmentsComponent } from './attachments.component';
import { LoadsService } from '../../../../services/loads.service';
import { LoadAttachment } from '../../../../models/load-dashboard.model';

function makeFile(name = 'rc.pdf', type = 'application/pdf'): File {
  return new File([new Blob([''])], name, { type });
}

function buildAttachmentsGroup(): FormGroup {
  const fb = new FormBuilder();
  return fb.group({
    queued: fb.array<FormGroup>([]),
  });
}

describe('LoadWizardAttachmentsComponent (FN-881)', () => {
  let fixture: ComponentFixture<LoadWizardAttachmentsComponent>;
  let component: LoadWizardAttachmentsComponent;
  let loadsService: jasmine.SpyObj<LoadsService>;

  beforeEach(async () => {
    loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', [
      'uploadAttachment',
      'uploadAttachmentWithProgress',
      'deleteAttachment',
    ]);

    await TestBed.configureTestingModule({
      imports: [LoadWizardAttachmentsComponent, ReactiveFormsModule],
      providers: [{ provide: LoadsService, useValue: loadsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadWizardAttachmentsComponent);
    component = fixture.componentInstance;
    component.attachmentsGroup = buildAttachmentsGroup();
  });

  describe('create mode', () => {
    beforeEach(() => {
      component.mode = 'create';
      component.loadId = null;
      fixture.detectChanges();
    });

    it('queues dropped files without calling upload', () => {
      const file = makeFile('ratecon.pdf');
      // Exercise the private addFiles path via the drop handler.
      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [file] as unknown as FileList },
      } as unknown as DragEvent);

      expect(component.queued.length).toBe(1);
      expect(component.queued.at(0).get('file')!.value).toBe(file);
      expect(component.queued.at(0).get('type')!.value).toBe('RATE_CONFIRMATION');
      expect(loadsService.uploadAttachmentWithProgress).not.toHaveBeenCalled();
      expect(loadsService.uploadAttachment).not.toHaveBeenCalled();
    });

    it('rejects files outside the PDF/PNG/JPG allow-list', () => {
      const bad = makeFile('invoice.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const good = makeFile('bol.jpg', 'image/jpeg');

      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [bad, good] as unknown as FileList },
      } as unknown as DragEvent);

      expect(component.queued.length).toBe(1);
      expect(component.queued.at(0).get('file')!.value).toBe(good);
    });

    it('removeQueued drops the entry at the given index', () => {
      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [makeFile('a.pdf')] as unknown as FileList },
      } as unknown as DragEvent);
      component.removeQueued(0);
      expect(component.queued.length).toBe(0);
    });
  });

  describe('edit mode (immediate upload)', () => {
    beforeEach(() => {
      component.mode = 'edit';
      component.loadId = 'load-123';
      fixture.detectChanges();
    });

    it('uploads immediately on drop and moves successes into `existing`', () => {
      const uploadedAtt: LoadAttachment = {
        id: 'att-1',
        load_id: 'load-123',
        type: 'RATE_CONFIRMATION',
        file_name: 'ratecon.pdf',
        created_at: new Date().toISOString(),
      };
      loadsService.uploadAttachmentWithProgress.and.returnValue(
        of({ progress: 100, result: { success: true, data: uploadedAtt } }),
      );

      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [makeFile('ratecon.pdf')] as unknown as FileList },
      } as unknown as DragEvent);

      expect(loadsService.uploadAttachmentWithProgress).toHaveBeenCalledWith(
        'load-123',
        jasmine.any(File),
        'RATE_CONFIRMATION',
        undefined,
      );
      expect(component.queued.length).toBe(0);
      expect(component.existing.length).toBe(1);
      expect(component.existing[0].id).toBe('att-1');
    });

    it('leaves the queued entry in an error state when upload fails so retry is available', () => {
      loadsService.uploadAttachmentWithProgress.and.returnValue(
        throwError(() => ({ error: { error: 'backend boom' } })),
      );

      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [makeFile('bol.pdf')] as unknown as FileList },
      } as unknown as DragEvent);

      expect(component.queued.length).toBe(1);
      const g = component.queued.at(0) as FormGroup;
      expect(g.get('uploading')!.value).toBe(false);
      expect(g.get('error')!.value).toBe('backend boom');
    });

    it('retryUpload re-invokes uploadAttachmentWithProgress for the same queued entry', () => {
      loadsService.uploadAttachmentWithProgress.and.returnValue(
        throwError(() => new Error('net down')),
      );

      component.onDrop({
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: { files: [makeFile('pod.pdf')] as unknown as FileList },
      } as unknown as DragEvent);
      expect(loadsService.uploadAttachmentWithProgress).toHaveBeenCalledTimes(1);

      loadsService.uploadAttachmentWithProgress.and.returnValue(
        of({
          progress: 100,
          result: {
            success: true,
            data: {
              id: 'att-2',
              load_id: 'load-123',
              type: 'PROOF_OF_DELIVERY',
              file_name: 'pod.pdf',
              created_at: new Date().toISOString(),
            } as LoadAttachment,
          },
        }),
      );
      component.retryUpload(0);

      expect(loadsService.uploadAttachmentWithProgress).toHaveBeenCalledTimes(2);
      expect(component.existing.length).toBe(1);
      expect(component.queued.length).toBe(0);
    });
  });

  describe('view mode', () => {
    beforeEach(() => {
      component.mode = 'view';
      component.loadId = 'load-123';
      component.existingAttachments = [
        {
          id: 'att-9',
          load_id: 'load-123',
          type: 'BOL',
          file_name: 'bol.pdf',
          file_url: 'https://example.com/bol.pdf',
          created_at: new Date().toISOString(),
        } as LoadAttachment,
      ];
      fixture.detectChanges();
    });

    it('renders the read-only list and hides the dropzone', () => {
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[data-testid="wa-dropzone"]')).toBeNull();
      expect(host.querySelector('.wa-existing-card')).toBeTruthy();
      expect(host.querySelector('a.wa-file-name')?.getAttribute('href'))
        .toBe('https://example.com/bol.pdf');
    });

    it('canUpload is false so drag handlers no-op', () => {
      expect(component.canUpload).toBe(false);
      component.onDragOver({ preventDefault: () => {}, stopPropagation: () => {} } as DragEvent);
      expect(component.isDragOver).toBe(false);
    });
  });

  describe('existing attachment delete', () => {
    beforeEach(() => {
      component.mode = 'edit';
      component.loadId = 'load-123';
      component.existingAttachments = [
        { id: 'att-1', load_id: 'load-123', type: 'BOL', file_name: 'a.pdf', created_at: '' } as LoadAttachment,
        { id: 'att-2', load_id: 'load-123', type: 'OTHER', file_name: 'b.pdf', created_at: '' } as LoadAttachment,
      ];
      fixture.detectChanges();
    });

    it('removes the deleted attachment and emits existingDeleted', () => {
      loadsService.deleteAttachment.and.returnValue(of({ success: true }));
      const emitted: string[] = [];
      component.existingDeleted.subscribe((id: string) => emitted.push(id));

      component.requestDelete('att-1');
      component.confirmDelete('att-1');

      expect(loadsService.deleteAttachment).toHaveBeenCalledWith('load-123', 'att-1');
      expect(component.existing.length).toBe(1);
      expect(component.existing[0].id).toBe('att-2');
      expect(emitted).toEqual(['att-1']);
    });
  });
});
