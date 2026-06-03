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
import { DuplicateWarningComponent } from './duplicate-warning/duplicate-warning.component';

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
  partsList: any[] = [];
  getParts(): Observable<any> { return of({ data: this.partsList }); }
  getPartCategories(): Observable<any> { return of({ data: [] }); }
  getPartManufacturers(): Observable<any> { return of({ data: [] }); }
  getPartById = jasmine.createSpy('getPartById').and.returnValue(of({ data: { id: 'p-1', sku: 'OIL-001', name: 'Oil Filter' } }));
  createPart = jasmine.createSpy('createPart').and.returnValue(of({ message: 'ok' }));
  updatePart = jasmine.createSpy('updatePart').and.returnValue(of({ message: 'ok' }));
  deactivatePart(): Observable<any> { return of({}); }
  downloadPartsTemplate(): Observable<any> { return of(new Blob()); }
  bulkUploadParts(): Observable<any> { return of({}); }
  getInventoryByPart(): Observable<any> { return of([]); }
  getPartsAnalysis(): Observable<any> { return of({}); }
  lookupBarcode = jasmine.createSpy('lookupBarcode');
  duplicateCheckParts = jasmine.createSpy('duplicateCheckParts').and.returnValue(of({ data: [] }));
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
        DuplicateWarningComponent,
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

  // FN-1365: SKU duplicate check on the photo flow (parity with FN-1107 barcode)
  describe('FN-1365 — SKU duplicate check after photo identify', () => {
    it('opens Edit Part modal when the AI SKU already exists in the catalog', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      // Simulate a duplicate-check hit on the AI-extracted SKU.
      api.duplicateCheckParts.and.returnValue(of({
        data: [
          { id: 'p-existing', sku: 'F002H20064', name: 'Oil filter', manufacturer: 'Bosch', similarity: 1.0 },
        ],
      }));
      api.getPartById.and.returnValue(of({
        data: {
          id: 'p-existing',
          sku: 'F002H20064',
          name: 'Oil filter',
          category: 'Filtration',
          manufacturer: 'Bosch',
          manufacturer_id: 7,
          unit_cost: 12.5,
          quantity_on_hand: 4,
          uom: 'each',
        },
      }));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(api.duplicateCheckParts).toHaveBeenCalled();
      const dupArg = api.duplicateCheckParts.calls.mostRecent().args[0];
      expect(dupArg.sku).toBe('F002H20064');
      expect(api.getPartById).toHaveBeenCalledWith('p-existing');

      // Edit mode: editingPartId set, NOT the prefilled-create flow.
      expect(component.showForm).toBe(true);
      expect(component.editingPartId).toBe('p-existing');
      expect(component.partForm.value.sku).toBe('F002H20064');
      // aiR2Key is only set on the Create-prefilled path; in Edit it stays null.
      expect(component.aiR2Key).toBeNull();
    });

    it('does case-insensitive SKU match', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse({ partNumber: 'abc-123' })));
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-1', sku: 'ABC-123', name: 'X', manufacturer: 'Y', similarity: 1.0 }],
      }));
      api.getPartById.and.returnValue(of({ data: { id: 'p-1', sku: 'ABC-123', name: 'X' } }));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.editingPartId).toBe('p-1');
    });

    it('opens Create prefilled when duplicate-check returns no exact SKU match', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      api.duplicateCheckParts.and.returnValue(of({
        // Fuzzy candidates but none matches the SKU exactly.
        data: [{ id: 'p-other', sku: 'F002H99999', name: 'Other filter', manufacturer: 'Bosch', similarity: 0.6 }],
      }));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.editingPartId).toBeNull();
      expect(component.showForm).toBe(true);
      expect(component.partForm.value.sku).toBe('F002H20064');
      expect(component.aiR2Key).toBe('parts/photos/abc.jpg');
      expect(api.getPartById).not.toHaveBeenCalled();
    });

    it('falls back to Create prefilled on duplicate-check error', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      api.duplicateCheckParts.and.returnValue(throwError(() => ({ status: 500 })));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.editingPartId).toBeNull();
      expect(component.showForm).toBe(true);
      expect(component.partForm.value.sku).toBe('F002H20064');
      expect(component.aiR2Key).toBe('parts/photos/abc.jpg');
    });

    it('skips the SKU lookup when AI returned no partNumber', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse({ partNumber: null })));

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(api.duplicateCheckParts).not.toHaveBeenCalled();
      expect(component.editingPartId).toBeNull();
      expect(component.showForm).toBe(true);
      expect(component.aiR2Key).toBe('parts/photos/abc.jpg');
    });

    it('falls back to local catalog cache when getPartById fails', () => {
      aiParts.identifyFromPhoto.and.returnValue(of(makeAiResponse()));
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-cached', sku: 'F002H20064', name: 'Oil filter', manufacturer: 'Bosch', similarity: 1.0 }],
      }));
      api.getPartById.and.returnValue(throwError(() => ({ status: 500 })));
      component.parts = [
        { id: 'p-cached', sku: 'F002H20064', name: 'Oil filter', category: 'Filtration', manufacturer: 'Bosch', uom: 'each', quantity_on_hand: 9 },
      ];

      component.onSnapPhotoSelected({ target: { files: [makeFile()] } } as unknown as Event);

      expect(component.editingPartId).toBe('p-cached');
      expect(component.partForm.value.quantity_on_hand).toBe(9);
    });
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

/**
 * FN-1107 unit specs — Quick Add → Scan Barcode flow.
 *
 * The acceptance criteria require three paths:
 *   - matched: lookup succeeds → close scanner → open Edit modal with full part record
 *   - unmatched: lookup returns 404 → close scanner → open Add modal with barcode prefilled (read-only)
 *   - malformed: server returns 5xx (or any non-404 error) → keep scanner open + surface error
 *
 * The barcode-scanner-dialog component itself handles the "no code detected
 * in image" path internally (toast + retry, no `scanned` event). That flow
 * is exercised by the dialog's own decode handler — here we focus on the
 * parts-catalog routing logic that runs after a value is captured.
 */
describe('PartsCatalogComponent — FN-1107 Scan Barcode flow', () => {
  let fixture: ComponentFixture<PartsCatalogComponent>;
  let component: PartsCatalogComponent;
  let api: ApiServiceStub;

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
    fixture.detectChanges();
  });

  it('startScanBarcode opens the dialog and closes the Quick Add menu', () => {
    component.quickAddOpen = true;
    component.startScanBarcode();
    expect(component.scannerOpen).toBe(true);
    expect(component.quickAddOpen).toBe(false);
    expect(component.scannerError).toBeNull();
    expect(component.scannerBusy).toBe(false);
  });

  describe('matched: lookup hits → close scanner → open Edit modal', () => {
    it('resolves the full part from the local catalog cache and opens Edit', () => {
      // Seed the in-memory catalog cache the way ngOnInit loadParts() would.
      const fullPart = {
        id: 'part-uuid-42',
        sku: 'SKU-42',
        name: 'Brake Pad — Bendix BP1234',
        category: 'Brakes',
        manufacturer: 'Bendix',
        manufacturer_id: 7,
        preferred_vendor_name: 'NAPA',
        vendor_id: 11,
        uom: 'each',
        unit_cost: 42.5,
        unit_price: 79.99,
        barcode: 'BPDE1234',
        quantity_on_hand: 12,
        reorder_level: 3,
      };
      component.parts = [fullPart];

      // Lookup endpoint only returns the partial record — Edit must hydrate
      // the missing fields (manufacturer/vendor/uom/qty) from the cache.
      api.lookupBarcode.and.returnValue(of({
        success: true,
        data: {
          barcode: { id: 'b1', barcode_value: 'BPDE1234', part_id: 'part-uuid-42' },
          part: {
            id: 'part-uuid-42',
            sku: 'SKU-42',
            name: 'Brake Pad — Bendix BP1234',
            category: 'Brakes',
            unit_price: 79.99,
            unit_cost: 42.5,
          },
          inventory_by_location: [],
        },
      }));

      component.startScanBarcode();
      component.onBarcodeScanned('BPDE1234');

      expect(api.lookupBarcode).toHaveBeenCalledWith('BPDE1234');
      expect(component.scannerOpen).toBe(false);
      expect(component.showForm).toBe(true);
      expect(component.editingPartId).toBe('part-uuid-42');
      // Full record (cache) values are present, not just the lookup partial.
      expect(component.partForm.value.manufacturer).toBe('Bendix');
      expect(component.partForm.value.uom).toBe('each');
      expect(component.partForm.value.quantity_on_hand).toBe(12);
      expect(component.barcodePrefilled).toBe(false);
    });

    it('falls back to the lookup partial if the part is not in the catalog cache', () => {
      component.parts = [];
      api.lookupBarcode.and.returnValue(of({
        success: true,
        data: {
          part: { id: 'orphan-1', sku: 'NEW-1', name: 'New Part', category: 'X', unit_price: 1, unit_cost: 1 },
        },
      }));

      component.startScanBarcode();
      component.onBarcodeScanned('ORPHAN');

      expect(component.scannerOpen).toBe(false);
      expect(component.showForm).toBe(true);
      expect(component.editingPartId).toBe('orphan-1');
      expect(component.partForm.value.sku).toBe('NEW-1');
    });
  });

  describe('unmatched: 404 → close scanner → Add modal with barcode prefilled (read-only)', () => {
    it('opens the Add modal, prefills barcode, and locks it', () => {
      api.lookupBarcode.and.returnValue(throwError(() => ({ status: 404, error: { error: 'Barcode not found' } })));

      component.startScanBarcode();
      component.onBarcodeScanned('NEW-CODE-9');

      expect(component.scannerOpen).toBe(false);
      expect(component.showForm).toBe(true);
      expect(component.editingPartId).toBeNull();
      expect(component.partForm.value.barcode).toBe('NEW-CODE-9');
      expect(component.barcodePrefilled).toBe(true);
    });

    it('treats 200 with no part record as unmatched (defensive)', () => {
      api.lookupBarcode.and.returnValue(of({ success: true, data: { part: null } }));

      component.startScanBarcode();
      component.onBarcodeScanned('NO-PART');

      expect(component.scannerOpen).toBe(false);
      expect(component.showForm).toBe(true);
      expect(component.partForm.value.barcode).toBe('NO-PART');
      expect(component.barcodePrefilled).toBe(true);
    });

    it('closeForm clears barcodePrefilled so a subsequent New Part is editable', () => {
      api.lookupBarcode.and.returnValue(throwError(() => ({ status: 404 })));
      component.startScanBarcode();
      component.onBarcodeScanned('NEW-CODE-9');
      expect(component.barcodePrefilled).toBe(true);

      component.closeForm();

      expect(component.barcodePrefilled).toBe(false);
    });
  });

  describe('malformed / lookup error: scanner stays open with inline error', () => {
    it('surfaces a 5xx server error and keeps the dialog open', () => {
      api.lookupBarcode.and.returnValue(throwError(() => ({
        status: 500,
        error: { error: 'database unavailable' },
      })));

      component.startScanBarcode();
      component.onBarcodeScanned('SOMECODE');

      expect(component.scannerOpen).toBe(true);
      expect(component.showForm).toBe(false);
      expect(component.scannerBusy).toBe(false);
      expect(component.scannerError).toContain('database unavailable');
    });

    it('rejects an empty/whitespace value without calling the API', () => {
      component.startScanBarcode();
      component.onBarcodeScanned('   ');

      expect(api.lookupBarcode).not.toHaveBeenCalled();
      expect(component.scannerOpen).toBe(true);
      expect(component.scannerError).toMatch(/empty/i);
    });

    it('clears the inline error and busy flag when the user retries successfully', () => {
      // First call fails with a server error.
      api.lookupBarcode.and.returnValue(throwError(() => ({ status: 500, error: { error: 'temporary glitch' } })));
      component.startScanBarcode();
      component.onBarcodeScanned('CODE-A');
      expect(component.scannerError).toBeTruthy();
      expect(component.scannerOpen).toBe(true);

      // Retry succeeds → scanner closes, error cleared.
      api.lookupBarcode.and.returnValue(of({ success: true, data: { part: { id: 'p1', sku: 'S1' } } }));
      component.parts = [{ id: 'p1', sku: 'S1', name: 'X', category: 'C', manufacturer: 'M', uom: 'each' }];
      component.onBarcodeScanned('CODE-A');

      expect(component.scannerOpen).toBe(false);
      expect(component.scannerError).toBeNull();
      expect(component.scannerBusy).toBe(false);
      expect(component.showForm).toBe(true);
    });
  });
});

describe('PartsCatalogComponent — FN-1111 duplicate detection + auto-SKU', () => {
  let fixture: ComponentFixture<PartsCatalogComponent>;
  let component: PartsCatalogComponent;
  let api: ApiServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterTestingModule],
      declarations: [
        PartsCatalogComponent,
        ConfidenceBadgeComponent,
        DuplicateWarningComponent,
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
    fixture.detectChanges();
    component.openForm();
  });

  describe('debounced duplicate-check', () => {
    it('coalesces rapid keystrokes into a single API call after 350ms', fakeAsync(() => {
      api.duplicateCheckParts.calls.reset();
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-1', name: 'Oil Filter', sku: 'OIL-1', manufacturer: 'Fleetguard', similarity: 0.92 }],
      }));

      component.partForm.patchValue({ name: 'O' });
      component.partForm.patchValue({ name: 'Oi' });
      component.partForm.patchValue({ name: 'Oil' });
      tick(100);
      expect(api.duplicateCheckParts).not.toHaveBeenCalled();

      tick(300);
      expect(api.duplicateCheckParts).toHaveBeenCalledTimes(1);
      const arg = api.duplicateCheckParts.calls.mostRecent().args[0];
      expect(arg.name).toBe('Oil');
      expect(arg.limit).toBe(5);
    }));

    it('renders the warning when candidates come back', fakeAsync(() => {
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-1', name: 'Oil Filter', sku: 'OIL-1', manufacturer: 'Fleetguard', similarity: 0.92 }],
      }));
      component.partForm.patchValue({ name: 'Oil' });
      tick(400);
      fixture.detectChanges();

      expect(component.duplicateCandidates.length).toBe(1);
      expect(component.showDuplicateWarning).toBe(true);
      expect(fixture.nativeElement.querySelector('app-duplicate-warning')).not.toBeNull();
    }));

    it('does NOT call the API when all three fields are empty (BE 400 guard)', fakeAsync(() => {
      api.duplicateCheckParts.calls.reset();
      component.partForm.patchValue({ name: 'x' });
      tick(400);
      api.duplicateCheckParts.calls.reset();
      component.partForm.patchValue({ name: '' });
      tick(400);
      expect(api.duplicateCheckParts).not.toHaveBeenCalled();
      expect(component.duplicateCandidates).toEqual([]);
    }));

    it('hides the warning when the next call returns empty (e.g. user changed name)', fakeAsync(() => {
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-1', name: 'Oil Filter', sku: 'OIL-1', manufacturer: 'Fleetguard', similarity: 0.92 }],
      }));
      component.partForm.patchValue({ name: 'Oil' });
      tick(400);
      expect(component.duplicateCandidates.length).toBe(1);

      api.duplicateCheckParts.and.returnValue(of({ data: [] }));
      component.partForm.patchValue({ name: 'FleetGuard FF5052' });
      tick(400);
      expect(component.duplicateCandidates).toEqual([]);
      expect(component.showDuplicateWarning).toBe(false);
    }));

    it('no-false-positive: typing "FleetGuard FF5052" with no similar parts shows nothing', fakeAsync(() => {
      api.duplicateCheckParts.and.returnValue(of({ data: [] }));
      component.partForm.patchValue({ name: 'FleetGuard FF5052' });
      tick(400);
      expect(component.duplicateCandidates).toEqual([]);
      expect(component.showDuplicateWarning).toBe(false);
    }));

    it('does NOT call the API in Edit mode', fakeAsync(() => {
      component.closeForm();
      component.openForm({ id: 'existing-1', sku: 'OIL-001', name: 'Oil Filter', category: 'Engine', manufacturer: 'Fleetguard' });
      api.duplicateCheckParts.calls.reset();

      component.partForm.patchValue({ name: 'Oil Filter v2' });
      tick(400);
      expect(api.duplicateCheckParts).not.toHaveBeenCalled();
    }));
  });

  describe('dismissal', () => {
    it('dismiss clears candidates and suppresses the warning for the rest of the session', fakeAsync(() => {
      api.duplicateCheckParts.and.returnValue(of({
        data: [{ id: 'p-1', name: 'Oil Filter', sku: 'OIL-1', manufacturer: 'Fleetguard', similarity: 0.92 }],
      }));
      component.partForm.patchValue({ name: 'Oil' });
      tick(400);
      expect(component.showDuplicateWarning).toBe(true);

      component.onDismissDuplicateWarning();
      expect(component.duplicateWarningDismissed).toBe(true);
      expect(component.showDuplicateWarning).toBe(false);

      api.duplicateCheckParts.calls.reset();
      component.partForm.patchValue({ name: 'Oil Filter Premium' });
      tick(400);
      expect(api.duplicateCheckParts).not.toHaveBeenCalled();
      expect(component.showDuplicateWarning).toBe(false);
    }));

    it('reopening the modal resets the dismissal flag', () => {
      component.duplicateWarningDismissed = true;
      component.duplicateCandidates = [{ id: 'p-1', name: 'X', sku: 'X-1', manufacturer: null, similarity: 0.9 }];

      component.closeForm();
      component.openForm();

      expect(component.duplicateWarningDismissed).toBe(false);
      expect(component.duplicateCandidates).toEqual([]);
    });
  });

  describe('edit-existing link', () => {
    it('closes the Add modal and reopens as Edit for the chosen candidate', fakeAsync(() => {
      const cand = { id: 'p-7', name: 'Oil Filter', sku: 'OIL-7', manufacturer: 'Fleetguard', similarity: 0.93 };
      api.getPartById.and.returnValue(of({ data: { id: 'p-7', sku: 'OIL-7', name: 'Oil Filter', category: 'Engine', manufacturer: 'Fleetguard' } }));

      component.onEditExistingDuplicate(cand);
      tick();

      expect(api.getPartById).toHaveBeenCalledWith('p-7');
      expect(component.editingPartId).toBe('p-7');
      expect(component.showForm).toBe(true);
      expect(component.partForm.value.sku).toBe('OIL-7');
    }));
  });

  describe('generate-SKU', () => {
    beforeEach(() => {
      component.partForm.patchValue({ manufacturer: 'Fleetguard', category: 'Engine' });
    });

    it('produces <MFG>-<CAT>-<NNNN> with uppercase 3-letter abbreviations', () => {
      api.partsList = [];
      component.parts = [];
      component.generateSku();
      const sku: string = component.partForm.value.sku;
      expect(sku).toMatch(/^FLE-ENG-\d{4}$/);
    });

    it('skips collisions against parts already in memory', () => {
      const taken: any[] = [];
      for (let i = 0; i < 9999; i++) {
        taken.push({ sku: `FLE-ENG-${String(i).padStart(4, '0')}` });
      }
      component.parts = taken;
      component.generateSku();
      expect(component.partForm.value.sku).toBe('FLE-ENG-9999');
    });

    it('errors out when manufacturer or category is missing', () => {
      component.partForm.patchValue({ manufacturer: '', category: 'Engine' });
      component.generateSku();
      expect(component.partForm.value.sku || '').toBe('');
      expect(component.errorMessage).toMatch(/manufacturer and category/i);
    });

    it('keeps the field editable (no readonly applied)', () => {
      component.parts = [];
      component.generateSku();
      const ctrl = component.partForm.get('sku')!;
      expect(ctrl.disabled).toBe(false);
      ctrl.setValue('CUSTOM-SKU-1');
      expect(component.partForm.value.sku).toBe('CUSTOM-SKU-1');
    });
  });

  // FN-1399: Print Label flow on part create
  describe('FN-1399 — Print Label flow', () => {
    it('opens the print confirm modal when create response includes a backend-generated barcode', () => {
      api.createPart.and.returnValue(of({
        message: 'Part created',
        data: { id: 'p-new', sku: 'BOS-FIL-0001', name: 'Oil Filter', barcode: 'FN-AB23CD45' },
      }));
      component.openForm();
      component.partForm.patchValue({
        sku: 'BOS-FIL-0001',
        name: 'Oil Filter',
        category: 'Filtration',
        manufacturer: 'Bosch',
        unit_cost: 10,
      });
      component.savePart();

      expect(component.printablePart).toEqual(jasmine.objectContaining({
        sku: 'BOS-FIL-0001',
        barcode: 'FN-AB23CD45',
      }));
    });

    it('does not open the print modal if the create response has no barcode', () => {
      api.createPart.and.returnValue(of({ message: 'ok', data: { id: 'p-new', sku: 'X', name: 'Y' } }));
      component.openForm();
      component.partForm.patchValue({
        sku: 'X', name: 'Y', category: 'Z', manufacturer: 'M', unit_cost: 1,
      });
      component.savePart();
      expect(component.printablePart).toBeNull();
    });

    it('printLabelForPart sets partForLabel and triggers window.print', fakeAsync(() => {
      const printSpy = spyOn(window, 'print');
      component.printLabelForPart({ id: 'p-1', sku: 'A', name: 'B', barcode: 'FN-XYZ12345' });
      expect(component.partForLabel).toEqual(jasmine.objectContaining({ barcode: 'FN-XYZ12345' }));
      tick(50);
      expect(printSpy).toHaveBeenCalled();
      tick(500);
      expect(component.partForLabel).toBeNull();
    }));

    it('printLabelForPart no-ops on a part with no barcode', () => {
      const printSpy = spyOn(window, 'print');
      component.printLabelForPart({ id: 'p-1', sku: 'A', name: 'B' });
      expect(printSpy).not.toHaveBeenCalled();
      expect(component.partForLabel).toBeNull();
    });

    it('dismissPrintConfirm clears the modal without printing', () => {
      const printSpy = spyOn(window, 'print');
      component.printablePart = { id: 'p-1', sku: 'A', name: 'B', barcode: 'FN-XYZ12345' };
      component.dismissPrintConfirm();
      expect(component.printablePart).toBeNull();
      expect(printSpy).not.toHaveBeenCalled();
    });

    it('vendorBarcodeOverride defaults to false on each open and resets on close', () => {
      component.openForm();
      expect(component.vendorBarcodeOverride).toBe(false);
      component.vendorBarcodeOverride = true;
      component.closeForm();
      expect(component.vendorBarcodeOverride).toBe(false);
    });
  });
});

describe('PartsCatalogComponent — FN-1543 Save no-op for invoice/bulk-uploaded parts', () => {
  let fixture: ComponentFixture<PartsCatalogComponent>;
  let component: PartsCatalogComponent;
  let api: ApiServiceStub;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterTestingModule],
      declarations: [
        PartsCatalogComponent,
        ConfidenceBadgeComponent,
        DuplicateWarningComponent,
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
    fixture.detectChanges();
  });

  // The bug: a bulk-uploaded part with null required fields would set the
  // form to permanently invalid via patchValue, the Save button's
  // [disabled]="!partForm.valid" gate would never lift, and a click would
  // silently no-op. The fix coerces nulls to safe defaults and surfaces a
  // visible toast listing what the user still needs to fill in.

  it('openForm coerces null required fields so the form starts editable', () => {
    const bulkPart = {
      id: 'p-bulk-1',
      sku: 'BULK-001',
      name: 'Bulk Part',
      category: null,
      manufacturer: null,
      unit_cost: null,
      unit_price: 9.99,
    };

    component.openForm(bulkPart);

    expect(component.partForm.value.category).toBe('');
    expect(component.partForm.value.manufacturer).toBe('');
    expect(component.partForm.value.unit_cost).toBe(0);
    expect(component.partForm.value.unit_price).toBe(9.99);
  });

  it('savePart on an invalid form surfaces a toast listing missing fields and does not call the API', () => {
    component.openForm({
      id: 'p-bulk-1',
      sku: 'BULK-001',
      name: 'Bulk Part',
      category: null,
      manufacturer: null,
      unit_cost: null,
    });

    component.partForm.patchValue({ unit_price: 19.99 });

    component.savePart();

    expect(api.updatePart).not.toHaveBeenCalled();
    expect(component.errorMessage).toMatch(/Please fill in:/);
    expect(component.errorMessage).toContain('Category');
    expect(component.errorMessage).toContain('Manufacturer');
    expect(component.partForm.get('category')?.touched).toBe(true);
    expect(component.partForm.get('manufacturer')?.touched).toBe(true);
  });

  it('savePart succeeds once the user fills in the missing required fields', () => {
    component.openForm({
      id: 'p-bulk-1',
      sku: 'BULK-001',
      name: 'Bulk Part',
      category: null,
      manufacturer: null,
      unit_cost: null,
    });

    component.partForm.patchValue({
      category: 'Filtration',
      manufacturer: 'Bosch',
      unit_cost: 5,
      unit_price: 19.99,
    });

    component.savePart();

    expect(api.updatePart).toHaveBeenCalled();
    const [id, payload] = api.updatePart.calls.mostRecent().args;
    expect(id).toBe('p-bulk-1');
    expect(payload.unit_price).toBe(19.99);
    expect(payload.category).toBe('Filtration');
  });

  it('savePart on a manually-created part with all required fields populated still saves (no regression)', () => {
    component.openForm({
      id: 'p-manual-1',
      sku: 'MAN-001',
      name: 'Manual Part',
      category: 'Filtration',
      manufacturer: 'Bosch',
      unit_cost: 5,
      unit_price: 9.99,
    });

    component.partForm.patchValue({ unit_price: 11.99 });

    component.savePart();

    expect(api.updatePart).toHaveBeenCalled();
    expect(component.errorMessage).toBe('');
  });
});
