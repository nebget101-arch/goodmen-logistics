/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { WoServiceDetailsTabComponent } from './service-details-tab.component';
import { ApiService } from '../../../../services/api.service';

describe('WoServiceDetailsTabComponent — FN-1443 availability badges', () => {
  let fixture: ComponentFixture<WoServiceDetailsTabComponent>;
  let component: WoServiceDetailsTabComponent;
  let apiSpy: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj<ApiService>('ApiService', [
      'triageEnrichedWorkOrder',
      'createPartsReorder'
    ]);

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, RouterTestingModule],
      declarations: [WoServiceDetailsTabComponent],
      providers: [{ provide: ApiService, useValue: apiSpy }]
    }).compileComponents();

    fixture = TestBed.createComponent(WoServiceDetailsTabComponent);
    component = fixture.componentInstance;
    component.workOrder = {
      id: 'wo-1',
      shopLocationId: 'loc-1',
      problemReported: 'engine misfire',
      labor: [],
      parts: [],
      status: 'DRAFT'
    };
    component.partsCatalog = [];
  });

  function triggerTriage(parts: Array<Record<string, unknown>>): void {
    apiSpy.triageEnrichedWorkOrder.and.returnValue(
      of({
        tasks: [],
        parts,
        priority: 'MEDIUM',
        notes: ''
      } as any)
    );
    component.runAiTriage();
  }

  it('renders an in-stock badge with bin location and qty', fakeAsync(() => {
    triggerTriage([
      {
        partName: 'Brake Pad Set',
        suggestedSku: 'BR-100',
        qty: 2,
        confidence: 0.9,
        partId: 'p1',
        onHand: 6,
        binLocation: 'Bin A-12',
        reorderPoint: 4,
        isLowStock: false,
        inventoryStatus: 'in_stock'
      }
    ]);
    tick();
    fixture.detectChanges();

    const part = component.aiTriageResult.parts[0];
    expect(part.inventoryStatus).toBe('in_stock');
    expect(component.canReorder(part)).toBeFalse();

    const badge = fixture.nativeElement.querySelector('.avail-in-stock');
    expect(badge).withContext('in-stock badge should render').toBeTruthy();
    expect(badge.textContent).toContain('Bin A-12');
    expect(badge.textContent).toContain('qty 6');

    flush();
  }));

  it('renders an out-of-stock state with a working "Create reorder" button', fakeAsync(() => {
    apiSpy.createPartsReorder.and.returnValue(of({ success: true, data: { id: 'po-1' } }));

    triggerTriage([
      {
        partName: 'Oil Filter',
        suggestedSku: 'OF-200',
        qty: 1,
        confidence: 0.9,
        partId: 'p2',
        onHand: 0,
        binLocation: 'Bin C-3',
        reorderPoint: 5,
        isLowStock: true,
        inventoryStatus: 'out_of_stock'
      }
    ]);
    tick();
    fixture.detectChanges();

    const part = component.aiTriageResult.parts[0];
    expect(part.inventoryStatus).toBe('out_of_stock');
    expect(component.canReorder(part)).toBeTrue();

    const button: HTMLButtonElement | null = fixture.nativeElement.querySelector('.btn-create-reorder');
    expect(button).withContext('reorder button should render').toBeTruthy();

    button!.click();
    tick();
    fixture.detectChanges();

    expect(apiSpy.createPartsReorder).toHaveBeenCalledWith({
      locationId: 'loc-1',
      partId: 'p2',
      sku: 'OF-200',
      qty: 10, // max(reorderPoint*2 - onHand, qty, 1) = max(10-0, 1, 1) = 10
      sourceWorkOrderId: 'wo-1'
    });
    expect(part.reorderState).toBe('success');
    expect(component.toast).toBe('Reorder created');
    expect(fixture.nativeElement.querySelector('.reorder-confirmed')).toBeTruthy();

    flush();
  }));

  it('renders a "Catalog not found — search manually" link when SKU has no catalog match', fakeAsync(() => {
    triggerTriage([
      {
        partName: 'Mystery Part',
        suggestedSku: 'XYZ-999',
        qty: 1,
        confidence: 0.4,
        partId: null,
        onHand: null,
        binLocation: null,
        reorderPoint: null,
        isLowStock: false,
        inventoryStatus: 'not_found'
      }
    ]);
    tick();
    fixture.detectChanges();

    const part = component.aiTriageResult.parts[0];
    expect(part.inventoryStatus).toBe('not_found');

    const link = fixture.nativeElement.querySelector('.avail-not-found');
    expect(link).withContext('not-found link should render').toBeTruthy();
    expect(link.textContent).toContain('Catalog not found');

    expect(fixture.nativeElement.querySelector('.btn-create-reorder')).toBeNull();

    flush();
  }));

  it('hides the reorder CTA after a successful reorder', fakeAsync(() => {
    apiSpy.createPartsReorder.and.returnValue(of({ success: true }));

    triggerTriage([
      {
        partName: 'Air Filter',
        suggestedSku: 'AF-300',
        qty: 1,
        confidence: 0.85,
        partId: 'p3',
        onHand: 0,
        binLocation: null,
        reorderPoint: 3,
        isLowStock: true,
        inventoryStatus: 'out_of_stock'
      }
    ]);
    tick();
    fixture.detectChanges();

    const part = component.aiTriageResult.parts[0];
    component.createReorder(part);
    tick();
    fixture.detectChanges();

    expect(component.canReorder(part)).toBeFalse();
    expect(fixture.nativeElement.querySelector('.btn-create-reorder')).toBeNull();
    expect(fixture.nativeElement.querySelector('.reorder-confirmed')).toBeTruthy();

    flush();
  }));

  it('surfaces a reorder error inline and as an error toast', fakeAsync(() => {
    apiSpy.createPartsReorder.and.returnValue(
      throwError(() => ({ error: { error: 'inventory locked' } }))
    );

    triggerTriage([
      {
        partName: 'Belt',
        suggestedSku: 'BL-400',
        qty: 1,
        partId: 'p4',
        onHand: 0,
        binLocation: null,
        reorderPoint: 2,
        isLowStock: true,
        inventoryStatus: 'out_of_stock'
      }
    ]);
    tick();
    fixture.detectChanges();

    const part = component.aiTriageResult.parts[0];
    component.createReorder(part);
    tick();
    fixture.detectChanges();

    expect(part.reorderState).toBe('error');
    expect(component.toast).toBe('inventory locked');
    expect(component.toastType).toBe('error');

    flush();
  }));
});
