import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { ApiService } from '../../services/api.service';
import {
  QuickAddPanelComponent,
  QuickAddEvent
} from './quick-add-panel.component';

function makeApiStub(): jasmine.SpyObj<ApiService> {
  return jasmine.createSpyObj<ApiService>('ApiService', [
    'getParts',
    'getRecentPartsAtLocation',
    'getCommonPartsAtLocation'
  ]);
}

describe('QuickAddPanelComponent', () => {
  let fixture: ComponentFixture<QuickAddPanelComponent>;
  let component: QuickAddPanelComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = makeApiStub();
    api.getParts.and.returnValue(of({ data: [] }));
    api.getRecentPartsAtLocation.and.returnValue(of({ data: [] }));
    api.getCommonPartsAtLocation.and.returnValue(of({ data: [] }));

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [QuickAddPanelComponent],
      providers: [{ provide: ApiService, useValue: api }]
    }).compileComponents();

    fixture = TestBed.createComponent(QuickAddPanelComponent);
    component = fixture.componentInstance;
    component.locationId = 'loc-1';
    component.qtyMultiplier = 2;
  });

  it('starts on the search tab and shows "Type to search" before any input', () => {
    fixture.detectChanges();
    expect(component.activeTab).toBe('search');
    const empty = fixture.nativeElement.querySelector('.qap__empty');
    expect(empty?.textContent).toContain('Type to search');
  });

  it('debounces search and calls getParts with is_active=true after 250ms', fakeAsync(() => {
    api.getParts.and.returnValue(
      of({ data: [{ id: 'p1', sku: 'SKU1', name: 'Bolt' }] })
    );
    fixture.detectChanges();

    component.onSearchInput('bo');
    component.onSearchInput('bol');
    component.onSearchInput('bolt');

    tick(249);
    expect(api.getParts).not.toHaveBeenCalled();

    tick(1);
    expect(api.getParts).toHaveBeenCalledTimes(1);
    expect(api.getParts).toHaveBeenCalledWith({ search: 'bolt', is_active: true });
    expect(component.searchResults.length).toBe(1);
    expect(component.searchResults[0].sku).toBe('SKU1');
  }));

  it('caches recent results for 60s; switching tabs back does not refetch', fakeAsync(() => {
    api.getRecentPartsAtLocation.and.returnValue(
      of({ data: [{ id: 'p2', sku: 'SKU2', name: 'Filter' }] })
    );
    fixture.detectChanges();

    component.selectTab('recent');
    tick();
    expect(api.getRecentPartsAtLocation).toHaveBeenCalledTimes(1);

    component.selectTab('search');
    tick();
    component.selectTab('recent');
    tick();
    expect(api.getRecentPartsAtLocation).toHaveBeenCalledTimes(1);
  }));

  it('keeps recent and common caches independent per tab', fakeAsync(() => {
    api.getRecentPartsAtLocation.and.returnValue(of({ data: [{ id: 'r1', sku: 'R1', name: 'Recent' }] }));
    api.getCommonPartsAtLocation.and.returnValue(of({ data: [{ id: 'c1', sku: 'C1', name: 'Common' }] }));
    fixture.detectChanges();

    component.selectTab('recent');
    tick();
    component.selectTab('common');
    tick();

    expect(api.getRecentPartsAtLocation).toHaveBeenCalledTimes(1);
    expect(api.getCommonPartsAtLocation).toHaveBeenCalledTimes(1);
    expect(component.recentResults[0].sku).toBe('R1');
    expect(component.commonResults[0].sku).toBe('C1');
  }));

  it('renders empty state per tab when results are empty', fakeAsync(() => {
    fixture.detectChanges();

    component.selectTab('recent');
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No recent receivings here yet');

    component.selectTab('common');
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No common parts here yet');
  }));

  it('treats fetch errors as empty list (still shows empty state)', fakeAsync(() => {
    api.getRecentPartsAtLocation.and.returnValue(throwError(() => new Error('404')));
    fixture.detectChanges();

    component.selectTab('recent');
    tick();
    fixture.detectChanges();
    expect(component.recentResults).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('No recent receivings here yet');
  }));

  it('emits addPart with qty = qtyMultiplier on row click', () => {
    fixture.detectChanges();
    let captured: QuickAddEvent | null = null;
    component.addPart.subscribe((evt) => (captured = evt));

    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt', default_cost: 1.25 };
    component.onAddClick(part);

    expect(captured).not.toBeNull();
    expect(captured!.qty).toBe(2);
    expect(captured!.part.id).toBe('p1');
    // FN-1562 — emitted event now carries unitCost too.
    expect(captured!.unitCost).toBe(1.25);
  });

  it('FN-1546: per-row qty input multiplies with qtyMultiplier on add', () => {
    fixture.detectChanges();
    let captured: QuickAddEvent | null = null;
    component.addPart.subscribe((evt) => (captured = evt));

    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt' };
    component.setRowQty('p1', 3);
    expect(component.getRowQty('p1')).toBe(3);
    component.onAddClick(part);

    // 3 (user input) × 2 (qtyMultiplier) = 6
    expect(captured!.qty).toBe(6);
  });

  it('FN-1546: invalid qty inputs (0, negative, fractional, NaN) fall back to 1', () => {
    fixture.detectChanges();
    let captured: QuickAddEvent | null = null;
    component.addPart.subscribe((evt) => (captured = evt));
    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt' };

    component.setRowQty('p1', 0);
    expect(component.getRowQty('p1')).toBe(1);

    component.setRowQty('p1', -3);
    expect(component.getRowQty('p1')).toBe(1);

    component.setRowQty('p1', 'abc');
    expect(component.getRowQty('p1')).toBe(1);

    // 1.7 → floor(1.7) = 1, still ≥ 1, kept as 1
    component.setRowQty('p1', 1.7);
    expect(component.getRowQty('p1')).toBe(1);

    component.onAddClick(part);
    expect(captured!.qty).toBe(2); // 1 × qtyMultiplier(2)
  });

  it('FN-1546: per-part qty values are isolated', () => {
    fixture.detectChanges();
    const events: QuickAddEvent[] = [];
    component.addPart.subscribe((evt) => events.push(evt));

    component.setRowQty('p1', 4);
    // p2 untouched → defaults to 1

    component.onAddClick({ id: 'p1', sku: 'A', name: 'A' });
    component.onAddClick({ id: 'p2', sku: 'B', name: 'B' });

    expect(events[0].qty).toBe(8); // 4 × 2
    expect(events[1].qty).toBe(2); // 1 × 2
  });

  it('FN-1546: getRowQty returns default 1 for unknown parts', () => {
    fixture.detectChanges();
    expect(component.getRowQty('never-set')).toBe(1);
  });

  it('FN-1562: cost input defaults from part.default_cost', () => {
    fixture.detectChanges();
    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt', default_cost: 4.5 };
    expect(component.getRowCost(part)).toBe(4.5);
  });

  it('FN-1562: cost defaults to 0 when default_cost is null/undefined/invalid', () => {
    fixture.detectChanges();
    expect(component.getRowCost({ id: 'a', sku: 'A', name: 'A' })).toBe(0);
    expect(component.getRowCost({ id: 'b', sku: 'B', name: 'B', default_cost: null })).toBe(0);
    // Negative or non-finite values fall back to 0.
    expect(component.getRowCost({ id: 'c', sku: 'C', name: 'C', default_cost: -5 } as any)).toBe(0);
  });

  it('FN-1562: setRowCost overrides the default and is included in emitted event', () => {
    fixture.detectChanges();
    let captured: QuickAddEvent | null = null;
    component.addPart.subscribe((evt) => (captured = evt));

    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt', default_cost: 1.25 };
    component.setRowCost('p1', 9.99);
    expect(component.getRowCost(part)).toBe(9.99);

    component.onAddClick(part);
    expect(captured!.unitCost).toBe(9.99);
    expect(captured!.qty).toBe(2);
  });

  it('FN-1562: invalid cost inputs (negative, non-numeric) fall back to 0', () => {
    fixture.detectChanges();
    const part = { id: 'p1', sku: 'SKU1', name: 'Bolt', default_cost: 5 };

    component.setRowCost('p1', -3);
    expect(component.getRowCost(part)).toBe(0);

    component.setRowCost('p1', 'abc');
    expect(component.getRowCost(part)).toBe(0);
  });

  it('FN-1562: per-part cost values are isolated', () => {
    fixture.detectChanges();
    const events: QuickAddEvent[] = [];
    component.addPart.subscribe((evt) => events.push(evt));

    component.setRowCost('p1', 7.5);
    // p2 untouched → defaults from part.default_cost
    component.onAddClick({ id: 'p1', sku: 'A', name: 'A', default_cost: 1 });
    component.onAddClick({ id: 'p2', sku: 'B', name: 'B', default_cost: 2 });

    expect(events[0].unitCost).toBe(7.5);
    expect(events[1].unitCost).toBe(2);
  });

  it('does not emit when disabled', () => {
    component.disabled = true;
    fixture.detectChanges();
    let calls = 0;
    component.addPart.subscribe(() => calls++);

    component.onAddClick({ id: 'x', sku: 'X', name: 'X' });
    expect(calls).toBe(0);
  });

  it('Enter on a row emits addPart for that row', () => {
    fixture.detectChanges();
    let captured: QuickAddEvent | null = null;
    component.addPart.subscribe((evt) => (captured = evt));

    const list = [
      { id: 'a', sku: 'A', name: 'A part' },
      { id: 'b', sku: 'B', name: 'B part' }
    ];
    const evt = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(evt, 'preventDefault');
    component.onRowKeydown(evt, 1, list);

    expect(captured).not.toBeNull();
    expect(captured!.part.id).toBe('b');
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('clears caches and refetches active tab when locationId changes', fakeAsync(() => {
    api.getRecentPartsAtLocation.and.returnValue(of({ data: [{ id: 'p2', sku: 'SKU2', name: 'Filter' }] }));
    fixture.detectChanges();

    component.selectTab('recent');
    tick();
    expect(api.getRecentPartsAtLocation).toHaveBeenCalledTimes(1);

    component.locationId = 'loc-2';
    component.ngOnChanges({
      locationId: {
        currentValue: 'loc-2',
        previousValue: 'loc-1',
        firstChange: false,
        isFirstChange: () => false
      }
    });
    tick();
    expect(api.getRecentPartsAtLocation).toHaveBeenCalledTimes(2);
  }));
});
