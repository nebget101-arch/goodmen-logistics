/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { WarehouseReceivingComponent } from './warehouse-receiving.component';
import { ApiService } from '../../services/api.service';

const mockLocations = [
  { id: 'loc-warehouse', name: 'Main Warehouse' },
  { id: 'loc-other', name: 'Outpost' }
];

const mockDraftTicket = {
  id: 'tkt-1',
  ticket_number: 'RCV-LOC-1234567890-0001',
  vendor_name: 'Acme',
  reference_number: 'PO-42',
  status: 'DRAFT',
  lines: [
    {
      id: 'line-1',
      part_id: 'part-1',
      sku: 'SKU-1',
      name: 'Existing part',
      qty_received: 3,
      unit_cost: 5,
      bin_location_override: null
    }
  ]
};

describe('WarehouseReceivingComponent (FN-1483)', () => {
  let fixture: ComponentFixture<WarehouseReceivingComponent>;
  let component: WarehouseReceivingComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'getLocations',
      'getReceivingDraft',
      'createReceivingTicket',
      'addReceivingLine',
      'deleteReceivingLine',
      'postReceivingTicket',
      'getReceivingTodaySummary',
      'lookupBarcode',
      'createScanBridgeSession',
      'decodeBarcodeFromImage',
      'getBaseUrl',
      'updateReceivingLine',
      'updatePartCost'
    ]);

    api.getLocations.and.returnValue(of({ data: mockLocations }));
    api.getReceivingDraft.and.returnValue(of({ data: null }));
    api.createReceivingTicket.and.returnValue(of({ data: { ...mockDraftTicket, lines: [] } }));
    api.getReceivingTodaySummary.and.returnValue(of({ data: { totalParts: 7, totalLines: 5, totalTickets: 2 } }));
    api.getBaseUrl.and.returnValue('http://test');

    await TestBed.configureTestingModule({
      declarations: [WarehouseReceivingComponent],
      imports: [FormsModule],
      providers: [{ provide: ApiService, useValue: api }],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(WarehouseReceivingComponent);
    component = fixture.componentInstance;
  });

  it('creates a DRAFT ticket on first location load when none exists', () => {
    fixture.detectChanges();

    expect(api.getLocations).toHaveBeenCalled();
    expect(component.locationId).toBe('loc-warehouse');
    expect(api.getReceivingDraft).toHaveBeenCalledWith('loc-warehouse');
    expect(api.createReceivingTicket).toHaveBeenCalledWith('loc-warehouse');
    expect(api.getReceivingTodaySummary).toHaveBeenCalledWith('loc-warehouse');
    expect(component.ticket?.id).toBe('tkt-1');
    expect(component.ticket?.lines.length).toBe(0);
    expect(component.todaySummary).toEqual({ partsReceived: 7, ticketsPosted: 2 });
  });

  it('restores an open DRAFT for the current location on refresh', () => {
    api.getReceivingDraft.and.returnValue(of({ data: mockDraftTicket }));

    fixture.detectChanges();

    expect(api.createReceivingTicket).not.toHaveBeenCalled();
    expect(component.ticket?.ticketNumber).toBe('RCV-LOC-1234567890-0001');
    expect(component.lines.length).toBe(1);
    expect(component.lines[0]).toEqual(jasmine.objectContaining({
      id: 'line-1',
      sku: 'SKU-1',
      qty: 3
    }));
  });

  it('calls addReceivingLine with the resolved part on scan', () => {
    fixture.detectChanges();
    api.lookupBarcode.and.returnValue(of({
      data: {
        part: { id: 'part-2', sku: 'SKU-2', name: 'New part', default_cost: 9 },
        barcode: { pack_qty: 4 }
      }
    }));
    api.addReceivingLine.and.returnValue(of({
      data: { id: 'line-2', qty_received: 8, unit_cost: 9, bin_location_override: null }
    }));

    component.qtyMultiplier = 2;
    component.scanCode = 'BARCODE-2';
    component.onScanEnter();

    expect(api.lookupBarcode).toHaveBeenCalledWith('BARCODE-2', 'loc-warehouse');
    // pack_qty (4) × qtyMultiplier (2) = 8
    expect(api.addReceivingLine).toHaveBeenCalledWith('tkt-1', 'part-2', 8, 9);
    expect(component.lines.length).toBe(1);
    expect(component.lines[0]).toEqual(jasmine.objectContaining({ id: 'line-2', sku: 'SKU-2', qty: 8 }));
    expect(component.scanCode).toBe('');
  });

  it('calls deleteReceivingLine and removes the line locally', () => {
    api.getReceivingDraft.and.returnValue(of({ data: mockDraftTicket }));
    fixture.detectChanges();
    api.deleteReceivingLine.and.returnValue(of({ success: true }));

    const line = component.lines[0];
    component.removeLine(line);

    expect(api.deleteReceivingLine).toHaveBeenCalledWith('tkt-1', 'line-1');
    expect(component.lines.length).toBe(0);
  });

  it('posts the ticket and shows the ticket number in the success message', () => {
    api.getReceivingDraft.and.returnValue(of({ data: mockDraftTicket }));
    fixture.detectChanges();

    api.postReceivingTicket.and.returnValue(of({ data: { id: 'tkt-1' } }));
    api.getReceivingTodaySummary.and.returnValue(of({ data: { totalParts: 10, totalLines: 12, totalTickets: 3 } }));
    api.getReceivingDraft.and.returnValue(of({ data: null }));
    api.createReceivingTicket.and.returnValue(of({ data: { ...mockDraftTicket, id: 'tkt-2', ticket_number: 'RCV-LOC-NEXT', lines: [] } }));

    component.postReceiving();

    expect(api.postReceivingTicket).toHaveBeenCalledWith('tkt-1');
    expect(component.message).toContain('RCV-LOC-1234567890-0001');
    expect(component.message).toContain('1 line');
    // After post, a fresh DRAFT is opened
    expect(component.ticket?.id).toBe('tkt-2');
    expect(component.todaySummary).toEqual({ partsReceived: 10, ticketsPosted: 3 });
  });

  it('surfaces the API error when post fails', () => {
    api.getReceivingDraft.and.returnValue(of({ data: mockDraftTicket }));
    fixture.detectChanges();

    api.postReceivingTicket.and.returnValue(throwError(() => ({ error: { error: 'boom' } })));
    component.postReceiving();

    expect(component.error).toBe('boom');
    expect(component.submitting).toBe(false);
  });

  it('does not post when there are no lines', () => {
    fixture.detectChanges();
    component.ticket!.lines = [];

    component.postReceiving();

    expect(api.postReceivingTicket).not.toHaveBeenCalled();
    expect(component.error).toBe('At least one line is required');
  });

  it('refreshes draft + summary when location changes', () => {
    fixture.detectChanges();
    api.getReceivingDraft.calls.reset();
    api.createReceivingTicket.calls.reset();
    api.getReceivingTodaySummary.calls.reset();

    component.locationId = 'loc-other';
    component.onLocationChange();

    expect(api.getReceivingDraft).toHaveBeenCalledWith('loc-other');
    expect(api.getReceivingTodaySummary).toHaveBeenCalledWith('loc-other');
  });

  it('falls back to creating a ticket when no DRAFT is available', fakeAsync(() => {
    api.getReceivingDraft.and.returnValue(throwError(() => ({ status: 404 })));

    fixture.detectChanges();
    tick();

    expect(api.createReceivingTicket).toHaveBeenCalledWith('loc-warehouse');
    expect(component.ticket?.id).toBe('tkt-1');
  }));

  it('keeps last summary when summary endpoint errors', () => {
    component.todaySummary = { partsReceived: 99, ticketsPosted: 9 };
    api.getReceivingTodaySummary.and.returnValue(throwError(() => ({ status: 404 })));

    fixture.detectChanges();

    expect(component.todaySummary).toEqual({ partsReceived: 99, ticketsPosted: 9 });
  });

  // ──────────────────────────────────────────────────────────────────────
  // FN-1562 — quick-add uses event.unitCost, inline cost edits, reconcile
  // ──────────────────────────────────────────────────────────────────────

  it('FN-1562: onQuickAdd posts the user-entered unitCost (not part.default_cost)', () => {
    fixture.detectChanges();
    api.addReceivingLine.and.returnValue(of({
      data: { id: 'line-3', qty_received: 5, unit_cost: 12.34, bin_location_override: null }
    }));

    component.onQuickAdd({
      part: { id: 'part-9', sku: 'SKU-9', name: 'Sensor', default_cost: 0 },
      qty: 5,
      unitCost: 12.34
    });

    expect(api.addReceivingLine).toHaveBeenCalledWith('tkt-1', 'part-9', 5, 12.34);
    expect(component.lines[0]).toEqual(jasmine.objectContaining({ id: 'line-3', unitCost: 12.34 }));
  });

  it('FN-1562: surfaces a reconcile prompt when entered cost differs from default by > 1¢', () => {
    fixture.detectChanges();
    api.addReceivingLine.and.returnValue(of({
      data: { id: 'line-4', qty_received: 1, unit_cost: 5, bin_location_override: null }
    }));

    component.onQuickAdd({
      part: { id: 'part-9', sku: 'SKU-9', name: 'Sensor', default_cost: 0 },
      qty: 1,
      unitCost: 5
    });

    expect(component.costReconcilePrompts.length).toBe(1);
    expect(component.costReconcilePrompts[0]).toEqual(jasmine.objectContaining({
      partId: 'part-9',
      sku: 'SKU-9',
      oldDefault: 0,
      newCost: 5
    }));
  });

  it('FN-1562: no reconcile prompt when entered cost matches default within 1¢', () => {
    fixture.detectChanges();
    api.addReceivingLine.and.returnValue(of({
      data: { id: 'line-5', qty_received: 1, unit_cost: 5, bin_location_override: null }
    }));

    component.onQuickAdd({
      part: { id: 'part-9', sku: 'SKU-9', name: 'Sensor', default_cost: 5.005 },
      qty: 1,
      unitCost: 5
    });

    expect(component.costReconcilePrompts.length).toBe(0);
  });

  it('FN-1562: "Skip all this session" mutes future reconcile prompts', () => {
    fixture.detectChanges();
    api.addReceivingLine.and.returnValue(of({
      data: { id: 'line-6', qty_received: 1, unit_cost: 8, bin_location_override: null }
    }));

    component.onQuickAdd({
      part: { id: 'part-9', sku: 'SKU-9', name: 'Sensor', default_cost: 0 },
      qty: 1,
      unitCost: 8
    });
    expect(component.costReconcilePrompts.length).toBe(1);

    component.onCostReconcileSkipAll();
    expect(component.costReconcilePrompts.length).toBe(0);
    expect(component.skipAllReconciles).toBeTrue();

    // Subsequent quick-add with mismatched cost should NOT enqueue a prompt.
    component.onQuickAdd({
      part: { id: 'part-10', sku: 'SKU-10', name: 'Other', default_cost: 0 },
      qty: 1,
      unitCost: 99
    });
    expect(component.costReconcilePrompts.length).toBe(0);
  });

  it('FN-1562: onCostReconcileUpdate calls updatePartCost and clears the prompt', () => {
    fixture.detectChanges();
    api.updatePartCost.and.returnValue(of({ data: { id: 'part-9' } }));
    component.costReconcilePrompts = [
      { partId: 'part-9', sku: 'SKU-9', oldDefault: 0, newCost: 7.5 }
    ];

    component.onCostReconcileUpdate(component.costReconcilePrompts[0]);

    expect(api.updatePartCost).toHaveBeenCalledWith('part-9', { default_cost: 7.5 });
    expect(component.costReconcilePrompts.length).toBe(0);
  });

  it('FN-1562: inline cost edit on DRAFT line PATCHes via updateReceivingLine and surfaces reconcile', () => {
    api.getReceivingDraft.and.returnValue(of({
      data: {
        ...mockDraftTicket,
        lines: [
          {
            id: 'line-1',
            part_id: 'part-1',
            sku: 'SKU-1',
            name: 'Existing part',
            qty_received: 3,
            unit_cost: 5,
            bin_location_override: null,
            part_default_cost: 5
          }
        ]
      }
    }));
    api.updateReceivingLine.and.returnValue(of({ data: {} }));
    fixture.detectChanges();

    const line = component.lines[0];
    expect(line.partDefaultCost).toBe(5);

    component.onLineCostFocus(line);
    component.onLineCostCommit(line, '7.50');

    expect(api.updateReceivingLine).toHaveBeenCalledWith('tkt-1', 'line-1', { unit_cost: 7.5 });
    expect(line.unitCost).toBe(7.5);
    expect(component.costReconcilePrompts.length).toBe(1);
    expect(component.costReconcilePrompts[0].partId).toBe('part-1');
  });

  it('FN-1562: inline cost edit reverts the optimistic update when PATCH fails', () => {
    api.getReceivingDraft.and.returnValue(of({
      data: {
        ...mockDraftTicket,
        lines: [
          {
            id: 'line-1',
            part_id: 'part-1',
            sku: 'SKU-1',
            name: 'Existing part',
            qty_received: 3,
            unit_cost: 5,
            bin_location_override: null
          }
        ]
      }
    }));
    api.updateReceivingLine.and.returnValue(throwError(() => ({ error: { error: 'denied' } })));
    fixture.detectChanges();

    const line = component.lines[0];
    component.onLineCostFocus(line);
    component.onLineCostCommit(line, '99');

    expect(line.unitCost).toBe(5); // reverted
    expect(component.error).toBe('denied');
  });

  it('FN-1562: inline cost edit is a no-op when the value is unchanged or invalid', () => {
    api.getReceivingDraft.and.returnValue(of({
      data: {
        ...mockDraftTicket,
        lines: [
          {
            id: 'line-1',
            part_id: 'part-1',
            sku: 'SKU-1',
            name: 'Existing part',
            qty_received: 3,
            unit_cost: 5,
            bin_location_override: null
          }
        ]
      }
    }));
    fixture.detectChanges();

    const line = component.lines[0];

    component.onLineCostFocus(line);
    component.onLineCostCommit(line, '5'); // unchanged
    expect(api.updateReceivingLine).not.toHaveBeenCalled();
    expect(line.unitCost).toBe(5);

    component.onLineCostFocus(line);
    component.onLineCostCommit(line, 'abc'); // invalid → revert
    expect(api.updateReceivingLine).not.toHaveBeenCalled();
    expect(line.unitCost).toBe(5);
  });
});
