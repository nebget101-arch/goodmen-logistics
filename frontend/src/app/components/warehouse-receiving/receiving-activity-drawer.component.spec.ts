/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ActivityDrawerTicket,
  ReceivingActivityDrawerComponent,
} from './receiving-activity-drawer.component';

const ticket: ActivityDrawerTicket = {
  id: 'tkt-1',
  ticketNumber: 'RCV-001',
  vendorName: 'Acme',
  referenceNumber: 'PO-100',
  postedAt: '2026-05-01T10:00:00Z',
  postedByName: 'Alice User',
  locationName: 'Main Warehouse',
  totalParts: 10,
  totalCost: 19,
  invoiceUrl: 'https://files.example/invoice.pdf',
  invoiceFileName: 'invoice.pdf',
  lines: [
    { sku: 'SKU-1', name: 'Bolt', qty: 4, unitCost: 2.5 },
    { sku: 'SKU-2', name: 'Nut', qty: 6, unitCost: 1.5 },
  ],
};

describe('ReceivingActivityDrawerComponent (FN-1494)', () => {
  let fixture: ComponentFixture<ReceivingActivityDrawerComponent>;
  let component: ReceivingActivityDrawerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ReceivingActivityDrawerComponent],
      imports: [CommonModule],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });

    fixture = TestBed.createComponent(ReceivingActivityDrawerComponent);
    component = fixture.componentInstance;
    component.ticket = ticket;
  });

  it('renders all line items + invoice link when supplied', () => {
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('RCV-001');
    expect(html).toContain('SKU-1');
    expect(html).toContain('SKU-2');
    expect(html).toContain('invoice.pdf');
  });

  it('emits close on Escape', () => {
    fixture.detectChanges();
    spyOn(component.close, 'emit');

    const evt = new KeyboardEvent('keydown', { key: 'Escape' });
    component.onEscape(evt);

    expect(component.close.emit).toHaveBeenCalled();
  });

  it('emits close when scrim is clicked (target equals currentTarget)', () => {
    fixture.detectChanges();
    spyOn(component.close, 'emit');

    const scrim = document.createElement('div');
    const evt = new MouseEvent('mousedown');
    Object.defineProperty(evt, 'target', { value: scrim });
    Object.defineProperty(evt, 'currentTarget', { value: scrim });
    component.onScrimClick(evt);

    expect(component.close.emit).toHaveBeenCalled();
  });

  it('does not emit close when click bubbles from inside the panel', () => {
    fixture.detectChanges();
    spyOn(component.close, 'emit');

    const scrim = document.createElement('div');
    const inner = document.createElement('button');
    const evt = new MouseEvent('mousedown');
    Object.defineProperty(evt, 'target', { value: inner });
    Object.defineProperty(evt, 'currentTarget', { value: scrim });
    component.onScrimClick(evt);

    expect(component.close.emit).not.toHaveBeenCalled();
  });

  it('hides invoice row when no invoiceUrl is provided', () => {
    component.ticket = { ...ticket, invoiceUrl: null, invoiceFileName: null };
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Open invoice');
  });
});
