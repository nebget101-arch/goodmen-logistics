import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';

import { PartsCatalogComponent } from './parts-catalog.component';
import { ApiService } from '../../services/api.service';
import { ManufacturersService } from '../../services/manufacturers.service';
import { VendorsService } from '../../services/vendors.service';
import {
  AiPartsService,
  PartPhotoIntakeResponse,
} from '../../services/ai-parts.service';
import { ConfidenceBadgeComponent } from '../shared/confidence-badge/confidence-badge.component';

/**
 * FN-1099 unit specs — Quick Add → Snap Photo flow.
 *
 * The acceptance criteria require:
 *   - capture → AI call → modal open with prefill (happy path)
 *   - error path: failure opens an empty form + surfaces a toast
 *
 * The full parts catalog has many other behaviors (filters, AI analysis,
 * stock breakdowns); those are out of scope for this subtask. We mock only
 * the collaborators the component touches at boot and during the photo flow.
 */

@Component({
  selector: 'app-master-typeahead',
  template: '',
})
class StubMasterTypeaheadComponent {
  @Input() value: any;
  @Input() searchFn: any;
  @Input() createFn: any;
  @Input() entityLabel: string = '';
  @Input() inputId: string = '';
  @Input() placeholder: string = '';
  @Output() valueChange = new EventEmitter<any>();
}

class ApiServiceStub {
  getParts(): Observable<any> { return of({ data: [] }); }
  getPartCategories(): Observable<any> { return of({ data: [] }); }
  getPartManufacturers(): Observable<any> { return of({ data: [] }); }
  createPart = jasmine.createSpy('createPart').and.returnValue(of({ message: 'ok' }));
  updatePart = jasmine.createSpy('updatePart').and.returnValue(of({ message: 'ok' }));
  deactivatePart(): Observable<any> { return of({}); }
  downloadPartsTemplate(): Observable<any> { return of(new Blob()); }
  bulkUploadParts(): Observable<any> { return of({}); }
  getInventoryByPart(): Observable<any> { return of([]); }
  getPartsAnalysis(): Observable<any> { return of({}); }
}

class ManufacturersServiceStub {
  search() { return of([]); }
  create(name: string) { return of({ id: 1, name }); }
}
class VendorsServiceStub {
  search() { return of([]); }
  create(name: string) { return of({ id: 1, name }); }
}
class AiPartsServiceStub {
  identifyFromPhoto = jasmine.createSpy('identifyFromPhoto');
}

function makeFile(name = 'part.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

function makeAiResponse(
  overrides: Partial<PartPhotoIntakeResponse['aiResult']> = {},
  r2Key = 'parts/photos/abc.jpg',
): PartPhotoIntakeResponse {
  return {
    success: true,
    aiResult: {
      manufacturer: 'Bosch',
      partNumber: 'F002H20064',
      category: 'Filtration',
      descriptionGuess: 'Oil filter cartridge',
      dimensionsGuess: null,
      confidence: {
        manufacturer: 0.9,
        partNumber: 0.92,
        category: 0.7,
        description: 0.5,
        dimensions: 0.2,
      },
      isUnreadable: false,
      warnings: [],
      ...overrides,
    },
    r2Key,
    meta: { processingTimeMs: 100, model: 'claude-sonnet-4' },
  };
}

describe('PartsCatalogComponent — FN-1099 Snap Photo flow', () => {
  let fixture: ComponentFixture<PartsCatalogComponent>;
  let component: PartsCatalogComponent;
  let api: ApiServiceStub;
  let aiParts: AiPartsServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterTestingModule],
      declarations: [
        PartsCatalogComponent,
        ConfidenceBadgeComponent,
        StubMasterTypeaheadComponent,
      ],
      providers: [
        { provide: ApiService, useClass: ApiServiceStub },
        { provide: ManufacturersService, useClass: ManufacturersServiceStub },
        { provide: VendorsService, useClass: VendorsServiceStub },
        { provide: AiPartsService, useClass: AiPartsServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PartsCatalogComponent);
    component = fixture.componentInstance;
    api = TestBed.inject(ApiService) as unknown as ApiServiceStub;
    aiParts = TestBed.inject(AiPartsService) as unknown as AiPartsServiceStub;
    fixture.detectChanges();
  });

  it('toggleQuickAdd flips the menu open/closed', () => {
    expect(component.quickAddOpen).toBe(false);
    component.toggleQuickAdd();
    expect(component.quickAddOpen).toBe(true);
    component.toggleQuickAdd();
    expect(component.quickAddOpen).toBe(false);
  });

  describe('happy path: capture → AI call → modal opens prefilled', () => {
    it('calls aiParts.identifyFromPhoto, opens the modal, and prefills with confidence badges', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));

      const file = makeFile();
      const event = { target: { files: [file] } } as unknown as Event;
      component.onSnapPhotoSelected(event);

      expect(aiParts.identifyFromPhoto).toHaveBeenCalledWith(file);
      expect(component.aiBusy).toBe(false);
      expect(component.showForm).toBe(true);
      expect(component.partForm.value.sku).toBe('F002H20064');
      expect(component.partForm.value.category).toBe('Filtration');
      expect(component.partForm.value.description).toBe('Oil filter cartridge');
      expect(component.manufacturerValue).toEqual({ id: null, name: 'Bosch' });
      expect(component.aiR2Key).toBe('parts/photos/abc.jpg');
      expect(component.aiConfidence.manufacturer).toBe(0.9);
      expect(component.aiConfidence.partNumber).toBe(0.92);
    });

    it('manufacturer is bound with id=null so the user must intentionally pick or create', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);
      expect(component.manufacturerValue?.id).toBeNull();
      expect(component.partForm.value.manufacturer_id).toBeNull();
      expect(component.partForm.value.manufacturer).toBe('Bosch');
    });

    it('passes image_r2_key on Save (createPart payload)', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      // Pretend the user picked an existing manufacturer record after reviewing.
      component.onManufacturerPick({ id: 42, name: 'Bosch' });

      component.savePart();

      expect(api.createPart).toHaveBeenCalled();
      const payload = api.createPart.calls.mostRecent().args[0];
      expect(payload.image_r2_key).toBe('parts/photos/abc.jpg');
      expect(payload.manufacturer_id).toBe(42);
    });
  });

  describe('badge clears on user override', () => {
    beforeEach(() => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);
    });

    it('partNumber badge clears when SKU is edited', () => {
      expect(component.aiConfidence.partNumber).toBe(0.92);
      component.partForm.patchValue({ sku: 'CUSTOM-1' });
      expect(component.aiConfidence.partNumber).toBeUndefined();
    });

    it('category badge clears when Category is edited', () => {
      expect(component.aiConfidence.category).toBe(0.7);
      component.partForm.patchValue({ category: 'Engine' });
      expect(component.aiConfidence.category).toBeUndefined();
    });

    it('description badge clears when Description is edited', () => {
      expect(component.aiConfidence.description).toBe(0.5);
      component.partForm.patchValue({ description: 'Custom note' });
      expect(component.aiConfidence.description).toBeUndefined();
    });

    it('manufacturer badge clears when the user picks from the typeahead', () => {
      expect(component.aiConfidence.manufacturer).toBe(0.9);
      component.onManufacturerPick({ id: 7, name: 'Bosch' });
      expect(component.aiConfidence.manufacturer).toBeUndefined();
    });
  });

  describe('error path: opens empty form + sets toast', () => {
    it('on AI call failure, opens form empty and shows the error message', () => {
      aiParts.identifyFromPhoto.and.returnValue(throwError(() => new Error('AI photo intake failed. Please fill the form manually.')));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.aiBusy).toBe(false);
      expect(component.showForm).toBe(true);
      // Form is empty: sku/category/description not prefilled
      expect(component.partForm.value.sku || '').toBe('');
      expect(component.partForm.value.category || '').toBe('');
      expect(component.aiR2Key).toBeNull();
      expect(component.errorMessage).toMatch(/AI photo intake failed/i);
    });

    it('on isUnreadable=true, opens form empty and surfaces the model warning', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse({
        isUnreadable: true,
        manufacturer: null,
        partNumber: null,
        warnings: ['Image too blurry to read text'],
      })));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.showForm).toBe(true);
      expect(component.partForm.value.sku || '').toBe('');
      expect(component.errorMessage).toContain('blurry');
      expect(component.aiR2Key).toBeNull();
    });

    it('does nothing if the user cancels the file dialog (no file selected)', () => {
      const event = { target: { files: [] } } as unknown as Event;
      component.onSnapPhotoSelected(event);
      expect(aiParts.identifyFromPhoto).not.toHaveBeenCalled();
      expect(component.aiBusy).toBe(false);
      expect(component.showForm).toBe(false);
    });
  });

  describe('cancel during loading', () => {
    it('cancelAiPhoto interrupts the in-flight call and clears the busy flag', fakeAsync(() => {
      // Build an Observable that never emits — emulates a slow AI call.
      let cancelled = false;
      aiParts.identifyFromPhoto.and.returnValue(new Observable(() => {
        return () => { cancelled = true; };
      }));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);
      expect(component.aiBusy).toBe(true);

      component.cancelAiPhoto();
      tick();

      expect(component.aiBusy).toBe(false);
      expect(cancelled).toBe(true);
      expect(component.showForm).toBe(false);
    }));
  });

  describe('closeForm clears AI state', () => {
    it('drops r2Key, confidence, and warnings on close', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse({
        warnings: ['Slight glare on the label'],
      })));
      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.aiR2Key).toBeTruthy();
      expect(component.aiWarnings.length).toBe(1);

      component.closeForm();

      expect(component.aiR2Key).toBeNull();
      expect(component.aiWarnings).toEqual([]);
      expect(component.aiConfidence).toEqual({});
    });
  });
});
