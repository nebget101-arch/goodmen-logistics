/// <reference types="jasmine" />

import { TestBed } from '@angular/core/testing';
import { DrilldownService } from './drilldown.service';
import { ReportFilters } from '../reports.models';

describe('DrilldownService', () => {
  let service: DrilldownService;

  const dateFilters: ReportFilters = {
    startDate: '2026-04-01',
    endDate: '2026-04-30'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DrilldownService);
  });

  describe('getRowTarget', () => {
    it('returns null for empty rows', () => {
      expect(service.getRowTarget('total-revenue', null as never, {})).toBeNull();
    });

    it('returns null when no identifier columns are present', () => {
      const target = service.getRowTarget(
        'total-revenue',
        { period: '2026-04-01', total_revenue: 1000 },
        dateFilters
      );
      expect(target).toBeNull();
    });

    it('routes load_id rows to /loads with loadId query', () => {
      const target = service.getRowTarget(
        'gross-profit-per-load',
        { load_id: 'L-123', load_number: 'GM-001', revenue: 1500 },
        dateFilters
      );
      expect(target).toEqual({
        destination: 'loads',
        commands: ['/loads'],
        queryParams: { loadId: 'L-123' }
      });
    });

    it('routes customer_id rows to /shop-clients/:id', () => {
      const target = service.getRowTarget(
        'payment-summary',
        { customer_id: 'cust-9', method: 'ACH', total_paid: 4200 },
        dateFilters
      );
      expect(target).toEqual({
        destination: 'customers',
        commands: ['/shop-clients', 'cust-9']
      });
    });

    it('falls back to broker_id when customer_id is missing', () => {
      const target = service.getRowTarget(
        'payment-summary',
        { broker_id: 'b-7', method: 'Wire' },
        dateFilters
      );
      expect(target).toEqual({
        destination: 'customers',
        commands: ['/shop-clients', 'b-7']
      });
    });

    it('routes driver_id rows to /drivers with driverId + date range', () => {
      const target = service.getRowTarget(
        'direct-load-profit',
        { driver_id: 'drv-42', driver_name: 'Jane Doe' },
        dateFilters
      );
      expect(target).toEqual({
        destination: 'drivers',
        commands: ['/drivers'],
        queryParams: { from: '2026-04-01', to: '2026-04-30', driverId: 'drv-42' }
      });
    });

    it('routes revenue-by-dispatcher rows with dispatcher_id to /loads filtered by date+dispatcher', () => {
      const target = service.getRowTarget(
        'revenue-by-dispatcher',
        { dispatcher_id: 'd-7', dispatcher_name: 'Alex', total_revenue: 12000 },
        dateFilters
      );
      expect(target).toEqual({
        destination: 'loads',
        commands: ['/loads'],
        queryParams: { from: '2026-04-01', to: '2026-04-30', dispatcherId: 'd-7' }
      });
    });

    it('does NOT add date params when filters are empty', () => {
      const target = service.getRowTarget(
        'revenue-by-dispatcher',
        { dispatcher_id: 'd-1' },
        {}
      );
      expect(target).toEqual({
        destination: 'loads',
        commands: ['/loads'],
        queryParams: { dispatcherId: 'd-1' }
      });
    });

    it('honors legacy date_from/date_to filter keys', () => {
      const target = service.getRowTarget(
        'revenue-by-dispatcher',
        { dispatcher_id: 'd-2' },
        { date_from: '2026-03-01', date_to: '2026-03-31' }
      );
      expect(target?.queryParams).toEqual({
        from: '2026-03-01',
        to: '2026-03-31',
        dispatcherId: 'd-2'
      });
    });

    it('prefers loadId over driver/customer when row has multiple ids', () => {
      const target = service.getRowTarget(
        'fully-loaded-profit',
        { load_id: 'L-1', driver_id: 'drv-9', customer_id: 'cust-3' },
        dateFilters
      );
      expect(target?.destination).toBe('loads');
      expect(target?.queryParams).toEqual({ loadId: 'L-1' });
    });

    it('skips dispatcher drill-down for non-revenue-by-dispatcher reports', () => {
      const target = service.getRowTarget(
        'total-revenue',
        { dispatcher_id: 'd-7', period: '2026-04' },
        dateFilters
      );
      expect(target).toBeNull();
    });
  });

  describe('getCardTarget', () => {
    it('returns null when cardKey is empty', () => {
      expect(service.getCardTarget('total-revenue', '', dateFilters)).toBeNull();
    });

    it('routes total_revenue card to /loads with date range', () => {
      const target = service.getCardTarget('total-revenue', 'total_revenue', dateFilters);
      expect(target).toEqual({
        destination: 'loads',
        commands: ['/loads'],
        queryParams: { from: '2026-04-01', to: '2026-04-30' }
      });
    });

    it('forwards dispatcherId/driverId from filters into card target', () => {
      const target = service.getCardTarget(
        'gross-profit',
        'gross_profit',
        { ...dateFilters, dispatcherId: 'd-3', driverId: 'drv-5' }
      );
      expect(target?.queryParams).toEqual({
        from: '2026-04-01',
        to: '2026-04-30',
        dispatcherId: 'd-3',
        driverId: 'drv-5'
      });
    });

    it('returns null for non-drillable card keys', () => {
      expect(service.getCardTarget('expenses', 'avg_completion_hours', dateFilters)).toBeNull();
    });

    it('routes payment-summary total_paid to /loads', () => {
      const target = service.getCardTarget('payment-summary', 'total_paid', dateFilters);
      expect(target?.destination).toBe('loads');
      expect(target?.queryParams).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    });
  });
});
