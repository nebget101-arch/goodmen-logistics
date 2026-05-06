import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Observable, of } from 'rxjs';

import { QuickAddInvoiceModalComponent } from './quick-add-invoice-modal.component';
import {
  AiPartsService,
  BulkCreateResponse,
  InvoiceAiResult,
} from '../../../services/ai-parts.service';
import { ManufacturersService } from '../../../services/manufacturers.service';
import { VendorsService } from '../../../services/vendors.service';
import { ConfidenceBadgeComponent } from '../../shared/confidence-badge/confidence-badge.component';

@Component({ selector: 'app-master-typeahead', template: '' })
class StubMasterTypeaheadComponent {
  @Input() value: any;
  @Input() searchFn: any;
  @Input() createFn: any;
  @Input() entityLabel: string = '';
  @Input() inputId: string = '';
  @Input() placeholder: string = '';
  @Input() disabled: boolean = false;
  @Output() valueChange = new EventEmitter<any>();
}

class AiPartsServiceStub {
  bulkCreate = jasmine.createSpy('bulkCreate');
}

class ManufacturersServiceStub {
  search(): Observable<any> { return of([]); }
  create(name: string): Observable<any> { return of({ id: 1, name }); }
}
class VendorsServiceStub {
  search(): Observable<any> { return of([]); }
  create(name: string): Observable<any> { return of({ id: 1, name }); }
}

function makeAiResult(overrides: Partial<InvoiceAiResult> = {}): InvoiceAiResult {
  return {
    vendor: 'NAPA',
    invoiceNumber: 'INV-001',
    confidence: { vendor: 0.95, invoiceNumber: 0.9 },
    lineItems: [
      {
        sku: 'FRAM-PH7317',
        description: 'Oil filter',
        qty: 12,
        unitCost: 4.5,
        manufacturer: 'Fram',
        confidence: {
          sku: 0.92,
          description: 0.9,
          qty: 0.95,
          unitCost: 0.85,
          manufacturer: 0.88,
        },
      },
      {
        sku: 'WIX-51515',
        description: 'Oil filter',
        qty: 6,
        unitCost: 5.25,
        manufacturer: 'Wix',
        confidence: { sku: 0.7, description: 0.6, qty: 0.95, unitCost: 0.5, manufacturer: 0.8 },
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe('QuickAddInvoiceModalComponent (FN-1104)', () => {
  let fixture: ComponentFixture<QuickAddInvoiceModalComponent>;
  let component: QuickAddInvoiceModalComponent;
  let aiPartsService: AiPartsServiceStub;

  beforeEach(async () => {
    aiPartsService = new AiPartsServiceStub();

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [
        QuickAddInvoiceModalComponent,
        StubMasterTypeaheadComponent,
        ConfidenceBadgeComponent,
      ],
      providers: [
        { provide: AiPartsService, useValue: aiPartsService },
        { provide: ManufacturersService, useClass: ManufacturersServiceStub },
        { provide: VendorsService, useClass: VendorsServiceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuickAddInvoiceModalComponent);
    component = fixture.componentInstance;
    component.aiResult = makeAiResult();
    component.r2Key = 'parts/invoices/x.pdf';
    component.existingSkus = new Set<string>();
    fixture.detectChanges();
  });

  // AC: AI call → table render
  it('renders the AI-extracted lines and prefills vendor + invoice #', () => {
    expect(component.vendor).toBe('NAPA');
    expect(component.invoiceNumber).toBe('INV-001');
    expect(component.rows.length).toBe(2);

    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain('FRAM-PH7317');
    expect(html).toContain('WIX-51515');

    const checkboxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  // AC: Already-in-catalog SKUs flagged with skip + unchecked by default
  it('unchecks rows whose SKU already exists in the catalog', () => {
    component.existingSkus = new Set(['FRAM-PH7317']);
    component.ngOnChanges({
      existingSkus: { previousValue: undefined, currentValue: component.existingSkus, firstChange: false, isFirstChange: () => false },
    } as any);
    fixture.detectChanges();

    expect(component.rows[0].alreadyExists).toBe(true);
    expect(component.rows[0].selected).toBe(false);
    expect(component.rows[1].alreadyExists).toBe(false);
    expect(component.rows[1].selected).toBe(true);

    expect(fixture.nativeElement.innerHTML).toContain('Already in catalog');
  });

  // AC: Confirm and Create disabled if 0 lines selected
  it('disables Confirm when 0 rows are selected', () => {
    component.deselectAll();
    fixture.detectChanges();
    expect(component.canConfirm).toBe(false);

    const confirmBtn = fixture.nativeElement.querySelector('.btn-primary') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  // AC: Cells are editable inline + edit cell test
  it('updates a row when the user edits a cell', () => {
    const skuInputs = fixture.nativeElement.querySelectorAll('.col-sku .cell-input');
    const firstSku = skuInputs[0] as HTMLInputElement;
    firstSku.value = 'FRAM-NEW';
    firstSku.dispatchEvent(new Event('input'));
    expect(component.rows[0].sku).toBe('FRAM-NEW');
    // Editing clears the AI confidence on that field.
    expect(component.rows[0].confidence.sku).toBeUndefined();
  });

  // AC: bulk-create call with selected lines
  it('calls bulkCreate with only the selected rows on confirm', (done) => {
    component.rows[1].selected = false;
    fixture.detectChanges();

    const response: BulkCreateResponse = {
      success: true,
      created: [{ id: 'p1', sku: 'FRAM-PH7317', name: 'Oil filter' }],
      skipped: [],
    };
    aiPartsService.bulkCreate.and.returnValue(of(response));

    component.confirmed.subscribe((res) => {
      expect(res.created.length).toBe(1);
      done();
    });

    component.confirm();

    expect(aiPartsService.bulkCreate).toHaveBeenCalledTimes(1);
    const items = aiPartsService.bulkCreate.calls.mostRecent().args[0];
    expect(items.length).toBe(1);
    expect(items[0].sku).toBe('FRAM-PH7317');
    expect(items[0].name).toBe('Oil filter');
    expect(items[0].preferred_vendor_name).toBe('NAPA');
    expect(items[0].manufacturer).toBe('Fram');
    expect(items[0].unit_cost).toBe(4.5);
  });

  // AC: Failure: per-line error messages from the bulk endpoint surface inline
  it('surfaces per-row reasons inline when the bulk endpoint reports skipped items', () => {
    aiPartsService.bulkCreate.and.returnValue(
      of<BulkCreateResponse>({
        success: true,
        created: [{ id: 'p1', sku: 'FRAM-PH7317', name: 'Oil filter' }],
        skipped: [{ sku: 'WIX-51515', reason: 'sku_exists' }],
      }),
    );

    component.confirm();
    fixture.detectChanges();

    expect(component.rowErrors['WIX-51515']).toMatch(/Already in catalog/i);
    expect(fixture.nativeElement.innerHTML).toContain('Already in catalog');
  });

  it('emits closed when cancel is pressed', (done) => {
    component.closed.subscribe(() => done());
    component.cancel();
  });

  // FN-1365: editable per-row Category column
  describe('FN-1365 — editable Category column', () => {
    it('renders a Category column header and per-row category input', () => {
      const headers = fixture.nativeElement.querySelectorAll('.invoice-lines-table thead th');
      const headerText = Array.from(headers).map((h: any) => h.textContent.trim()).join('|');
      expect(headerText).toContain('Category');

      const catInputs = fixture.nativeElement.querySelectorAll('.col-cat .cell-input');
      expect(catInputs.length).toBe(2);
    });

    it('persists category edits into the row state and bulk-create payload', () => {
      const catInputs = fixture.nativeElement.querySelectorAll('.col-cat .cell-input');
      const firstCat = catInputs[0] as HTMLInputElement;
      firstCat.value = 'Filtration';
      firstCat.dispatchEvent(new Event('input'));
      expect(component.rows[0].category).toBe('Filtration');

      aiPartsService.bulkCreate.and.returnValue(
        of<BulkCreateResponse>({
          success: true,
          created: [{ id: 'p1', sku: 'FRAM-PH7317', name: 'Oil filter' }],
          skipped: [],
        }),
      );

      // Only the first row has a category — the second stays blank.
      component.rows[1].selected = true;
      component.confirm();

      const items = aiPartsService.bulkCreate.calls.mostRecent().args[0];
      expect(items.length).toBe(2);
      expect(items[0].category).toBe('Filtration');
      // Blank category is omitted from the payload (BE/DB tolerate null).
      expect(items[1].category).toBeUndefined();
    });
  });
});
