/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { WoRepairHistoryWidgetComponent } from './repair-history-widget.component';
import { RepairHistorySummary, VehicleService } from '../../../services/vehicle.service';

class VehicleServiceStub {
  response: RepairHistorySummary | null = null;
  shouldError = false;

  getRepairHistorySummary() {
    if (this.shouldError) {
      return throwError(() => new Error('boom'));
    }
    return of(this.response as RepairHistorySummary);
  }
}

const buildSummary = (overrides: Partial<RepairHistorySummary> = {}): RepairHistorySummary => ({
  vehicleId: 'veh-1',
  vin: '1HGBH41JXMN109186',
  windowDays: 365,
  priorWoCount: 5,
  lastVisitDate: '2026-04-10',
  comebackRisk: 'medium',
  insufficientHistory: false,
  summary: 'Two repeat brake jobs in 90 days.',
  patterns: [
    {
      label: 'brake noise',
      occurrences: 3,
      lastDate: '2026-04-01',
      workOrders: [
        { workOrderId: 'wo-1', workOrderNumber: 'WO-1001', date: '2026-04-01' },
        { workOrderId: 'wo-2', workOrderNumber: 'WO-0987', date: '2026-02-12' }
      ]
    }
  ],
  ...overrides
});

describe('WoRepairHistoryWidgetComponent', () => {
  let fixture: ComponentFixture<WoRepairHistoryWidgetComponent>;
  let component: WoRepairHistoryWidgetComponent;
  let vehicleStub: VehicleServiceStub;

  beforeEach(async () => {
    vehicleStub = new VehicleServiceStub();

    await TestBed.configureTestingModule({
      declarations: [WoRepairHistoryWidgetComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [{ provide: VehicleService, useValue: vehicleStub }]
    }).compileComponents();

    fixture = TestBed.createComponent(WoRepairHistoryWidgetComponent);
    component = fixture.componentInstance;
  });

  function setVehicleId(id: string | null) {
    component.vehicleId = id;
    component.ngOnChanges({
      vehicleId: { previousValue: null, currentValue: id, firstChange: true, isFirstChange: () => true }
    } as any);
    fixture.detectChanges();
  }

  it('does nothing when no vehicleId is provided', () => {
    setVehicleId(null);
    expect(component.state).toBe('idle');
    const root = fixture.nativeElement.querySelector('.repair-history-widget');
    expect(root).toBeNull();
  });

  describe('comeback badge variants', () => {
    (['low', 'medium', 'high'] as const).forEach((risk) => {
      it(`renders the ${risk} comeback badge with the matching class`, () => {
        vehicleStub.response = buildSummary({ comebackRisk: risk });
        setVehicleId('veh-1');

        expect(component.badgeRisk).toBe(risk);
        expect(component.badgeClass).toBe(`risk-${risk}`);
        expect(component.badgeLabel.toLowerCase()).toContain(`${risk} comeback`);

        const badge = fixture.nativeElement.querySelector('.repair-history-widget__badge');
        expect(badge).toBeTruthy();
        expect(badge.classList.contains(`risk-${risk}`)).toBeTrue();
      });
    });
  });

  describe('insufficient history', () => {
    it('hides the comeback badge but still shows the count', () => {
      vehicleStub.response = buildSummary({
        priorWoCount: 1,
        comebackRisk: null,
        insufficientHistory: true,
        patterns: []
      });
      setVehicleId('veh-1');

      expect(component.insufficientHistory).toBeTrue();
      expect(component.badgeRisk).toBeNull();

      const root: HTMLElement = fixture.nativeElement;
      const riskBadge = root.querySelector('.repair-history-widget__badge.risk-low, .repair-history-widget__badge.risk-medium, .repair-history-widget__badge.risk-high');
      expect(riskBadge).toBeNull();

      const insufficientBadge = root.querySelector('.repair-history-widget__badge--insufficient');
      expect(insufficientBadge?.textContent).toContain('Not enough history');

      expect(root.querySelector('.repair-history-widget__count')?.textContent).toContain('1 prior WO');
    });
  });

  describe('expanded panel render', () => {
    it('renders pattern rows with WO links once expanded', () => {
      vehicleStub.response = buildSummary();
      setVehicleId('veh-1');

      expect(component.canExpand).toBeTrue();
      expect(component.expanded).toBeFalse();

      let panel = fixture.nativeElement.querySelector('.repair-history-widget__panel');
      expect(panel).toBeNull();

      component.toggleExpanded();
      fixture.detectChanges();

      panel = fixture.nativeElement.querySelector('.repair-history-widget__panel');
      expect(panel).toBeTruthy();

      const rows = panel.querySelectorAll('.repair-history-widget__pattern');
      expect(rows.length).toBe(1);
      expect(rows[0].querySelector('.repair-history-widget__pattern-label')?.textContent).toContain('brake noise');

      const links = panel.querySelectorAll('a.repair-history-widget__ref-link');
      expect(links.length).toBe(2);
      expect(links[0].getAttribute('href')).toContain('/work-order/wo-1');
    });

    it('does not allow expansion when patterns are empty', () => {
      vehicleStub.response = buildSummary({ patterns: [] });
      setVehicleId('veh-1');

      expect(component.canExpand).toBeFalse();
      component.toggleExpanded();
      expect(component.expanded).toBeFalse();
    });
  });

  it('surfaces a friendly error message when the request fails', () => {
    vehicleStub.shouldError = true;
    setVehicleId('veh-1');

    expect(component.state).toBe('error');
    expect(component.errorMessage).toBe('boom');
  });
});
