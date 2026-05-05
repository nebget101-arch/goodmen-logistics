/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';

import { PredictiveInsightsComponent } from './predictive-insights.component';
import {
  InsightsService,
  TrendsResponse,
} from '../../../services/insights.service';

function actualPoints(values: Array<number | null>): Array<{ date: string; value: number | null }> {
  return values.map((v, i) => ({ date: `2026-04-${(28 + i).toString().padStart(2, '0')}`, value: v }));
}

function predictedPoints(values: Array<number | null>): Array<{ date: string; value: number | null }> {
  return values.map((v, i) => ({ date: `2026-05-${(5 + i).toString().padStart(2, '0')}`, value: v }));
}

const mockResponse: TrendsResponse = {
  tenantId: 'tenant-1',
  range: '7d',
  generatedAt: '2026-05-04T12:00:00Z',
  cached: false,
  window: {
    actualDays: ['2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'],
    futureDays: ['2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10', '2026-05-11'],
  },
  upstreamErrors: [],
  series: {
    loadVolume: {
      actual: actualPoints([120, 125, 128, 130, 135, 140, 142]),
      predicted: predictedPoints([144, 147, 150, 152, 155, 158, 160]),
    },
    maintenance: {
      actual: actualPoints([6, 6, 5, 5, 4, 4, 4]),
      predicted: predictedPoints([4, 3, 3, 3, 2, 2, 2]),
    },
    onTimePct: {
      actual: actualPoints([91, 91.5, 92, 92.5, 93, 94, 94.5]),
      predicted: predictedPoints([95, 95.2, 95.5, 95.8, 96, 96.2, 96.5]),
    },
    fuelCost: {
      actual: actualPoints([0.58, 0.59, 0.6, 0.6, 0.61, 0.62, 0.62]),
      predicted: predictedPoints([0.63, 0.63, 0.64, 0.64, 0.65, 0.65, 0.66]),
    },
  },
};

const sparseResponse: TrendsResponse = {
  ...mockResponse,
  tenantId: 'tenant-2',
  upstreamErrors: [],
  series: {
    ...mockResponse.series,
    loadVolume: {
      actual: actualPoints([null, null, null, null, null, null, null]),
      predicted: predictedPoints([null, null, null, null, null, null, null]),
    },
  },
};

const partialFailResponse: TrendsResponse = {
  ...mockResponse,
  upstreamErrors: [{ source: 'fuelCost', error: 'connection reset' }],
};

describe('PredictiveInsightsComponent', () => {
  let fixture: ComponentFixture<PredictiveInsightsComponent>;
  let component: PredictiveInsightsComponent;
  let insightsService: jasmine.SpyObj<InsightsService>;

  beforeEach(async () => {
    insightsService = jasmine.createSpyObj<InsightsService>('InsightsService', ['getTrends']);
    insightsService.getTrends.and.returnValue(of(mockResponse));

    await TestBed.configureTestingModule({
      imports: [PredictiveInsightsComponent],
      providers: [{ provide: InsightsService, useValue: insightsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(PredictiveInsightsComponent);
    component = fixture.componentInstance;
  });

  it('shows the loading skeleton on first render before data resolves', () => {
    const pending = new Subject<TrendsResponse>();
    insightsService.getTrends.and.returnValue(pending.asObservable());

    fixture.detectChanges();

    expect(component.loading).toBe(true);
    expect(component.response).toBeNull();
    const skeleton = fixture.nativeElement.querySelector('.insights-card__skeleton');
    expect(skeleton).toBeTruthy();
    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-busy')).toBe('true');

    pending.next(mockResponse);
    pending.complete();
  });

  it('renders 4 sparkline cards when data resolves', () => {
    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.response).toEqual(mockResponse);

    const cells = fixture.nativeElement.querySelectorAll('.insights-card__cell');
    expect(cells.length).toBe(4);

    const labels = Array.from(cells, (c: any) =>
      c.querySelector('.insights-card__cell-label').textContent.trim(),
    );
    expect(labels).toEqual([
      'Load volume forecast',
      'Maintenance windows',
      'Projected on-time %',
      'Fuel cost trend',
    ]);
  });

  it('formats current values per unit (loads/raw/%/$)', () => {
    fixture.detectChanges();

    const values = Array.from(
      fixture.nativeElement.querySelectorAll('.insights-card__cell-value'),
      (el: any) => el.textContent.trim(),
    );
    expect(values[0]).toBe('142 loads');
    expect(values[1]).toBe('4');
    expect(values[2]).toBe('94.5%');
    expect(values[3]).toBe('$0.62');
  });

  it('renders the sparkline SVG path for each series with actual + predicted', () => {
    fixture.detectChanges();

    const svgs = fixture.nativeElement.querySelectorAll('svg.insights-card__sparkline');
    expect(svgs.length).toBe(4);

    const firstSvg = svgs[0];
    expect(firstSvg.querySelector('path.spark-actual')).toBeTruthy();
    expect(firstSvg.querySelector('path.spark-predicted')).toBeTruthy();
    expect(firstSvg.getAttribute('role')).toBe('img');
  });

  it('classifies direction as positive/negative based on series semantics', () => {
    expect(component.directionClass('up', 'loadVolume')).toBe('is-positive');
    expect(component.directionClass('up', 'fuelCost')).toBe('is-negative');
    expect(component.directionClass('up', 'maintenance')).toBe('is-negative');
    expect(component.directionClass('down', 'onTimePct')).toBe('is-negative');
    expect(component.directionClass('down', 'fuelCost')).toBe('is-positive');
    expect(component.directionClass('flat', 'loadVolume')).toBe('is-flat');
    expect(component.directionClass(null, 'loadVolume')).toBe('is-flat');
  });

  it('computes current/previous/delta from the actual array (latest non-null vs. earliest non-null)', () => {
    const stats = component.computeStats(mockResponse.series.loadVolume);
    expect(stats.current).toBe(142);
    expect(stats.previous).toBe(120);
    expect(stats.delta).toBe(22);
    expect(stats.direction).toBe('up');

    const fuel = component.computeStats(mockResponse.series.fuelCost);
    expect(fuel.current).toBeCloseTo(0.62, 2);
    expect(fuel.previous).toBeCloseTo(0.58, 2);
    expect(fuel.delta).toBeCloseTo(0.04, 2);
    expect(fuel.direction).toBe('up');
  });

  it('returns empty stats when actual has no non-null values', () => {
    const stats = component.computeStats(sparseResponse.series.loadVolume);
    expect(stats.current).toBeNull();
    expect(stats.previous).toBeNull();
    expect(stats.delta).toBeNull();
    expect(stats.direction).toBeNull();
  });

  it('renders the empty state for sparse series with no data points', () => {
    insightsService.getTrends.and.returnValue(of(sparseResponse));
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('.insights-card__cell');
    const firstCellEmpty = cells[0].querySelector('.insights-card__cell-empty');
    expect(firstCellEmpty).toBeTruthy();
    expect(firstCellEmpty.textContent).toContain('Not enough data yet');
    // Other cells with data still render values
    expect(cells[1].querySelector('.insights-card__cell-value')).toBeTruthy();
  });

  it('renders a "stale" badge on cards whose source is in upstreamErrors', () => {
    insightsService.getTrends.and.returnValue(of(partialFailResponse));
    fixture.detectChanges();

    const cells = fixture.nativeElement.querySelectorAll('.insights-card__cell');
    // fuelCost is the 4th card
    const fuelStale = cells[3].querySelector('.insights-card__cell-stale');
    expect(fuelStale).toBeTruthy();
    expect(fuelStale.textContent.trim()).toBe('stale');
    // loadVolume (1st) has no upstream error
    expect(cells[0].querySelector('.insights-card__cell-stale')).toBeFalsy();
  });

  it('renders the error fallback and a retry button when fetch fails', () => {
    insightsService.getTrends.and.returnValue(throwError(() => new Error('502')));
    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBeTruthy();

    const errorEl = fixture.nativeElement.querySelector('.insights-card__error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.getAttribute('role')).toBe('alert');
    expect(errorEl.querySelector('.insights-card__error-retry')).toBeTruthy();
  });

  it('calls getTrends with refresh=true when refresh() is invoked', fakeAsync(() => {
    fixture.detectChanges();
    expect(insightsService.getTrends).toHaveBeenCalledTimes(1);
    expect(insightsService.getTrends.calls.argsFor(0)[0]).toEqual({ range: '7d', refresh: false });

    component.refresh();
    tick();

    expect(insightsService.getTrends).toHaveBeenCalledTimes(2);
    expect(insightsService.getTrends.calls.argsFor(1)[0]).toEqual({ range: '7d', refresh: true });
  }));

  it('ignores re-entrant refresh while a refresh is already in flight', () => {
    const pending = new Subject<TrendsResponse>();
    insightsService.getTrends.and.returnValues(of(mockResponse), pending.asObservable());

    fixture.detectChanges();
    expect(insightsService.getTrends).toHaveBeenCalledTimes(1);

    component.refresh();
    expect(component.refreshing).toBe(true);
    component.refresh();
    expect(insightsService.getTrends).toHaveBeenCalledTimes(2);

    pending.next(mockResponse);
    pending.complete();
  });

  it('emits visibilityChange with hasBaseline=true when at least one series has data', () => {
    const events: Array<{ hasBaseline: boolean; firstBaselineEta: string | null }> = [];
    component.visibilityChange.subscribe((e) => events.push(e));
    fixture.detectChanges();

    expect(events).toEqual([{ hasBaseline: true, firstBaselineEta: null }]);
  });

  it('emits hasBaseline=false when every series is fully empty', () => {
    const empty: TrendsResponse = {
      ...sparseResponse,
      series: {
        loadVolume: { actual: actualPoints([null, null, null]), predicted: predictedPoints([null, null, null]) },
        maintenance: { actual: actualPoints([null, null, null]), predicted: predictedPoints([null, null, null]) },
        onTimePct: { actual: actualPoints([null, null, null]), predicted: predictedPoints([null, null, null]) },
        fuelCost: { actual: actualPoints([null, null, null]), predicted: predictedPoints([null, null, null]) },
      },
    };
    insightsService.getTrends.and.returnValue(of(empty));
    const events: Array<{ hasBaseline: boolean; firstBaselineEta: string | null }> = [];
    component.visibilityChange.subscribe((e) => events.push(e));
    fixture.detectChanges();

    expect(events).toEqual([{ hasBaseline: false, firstBaselineEta: null }]);
  });

  it('renders "First baseline ready by {date}" in empty cells when firstBaselineEta is set', () => {
    insightsService.getTrends.and.returnValue(
      of({ ...sparseResponse, firstBaselineEta: '2026-05-15' } as TrendsResponse),
    );
    fixture.detectChanges();

    const eta = fixture.nativeElement.querySelector('[data-testid="insights-first-baseline-eta"]');
    expect(eta).toBeTruthy();
    expect(eta.textContent).toContain('First baseline ready by 2026-05-15');
  });

  it('exposes accessible labels: region heading and refresh button', () => {
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-labelledby')).toBe('insights-heading');
    expect(fixture.nativeElement.querySelector('#insights-heading')).toBeTruthy();

    const refreshBtn = fixture.nativeElement.querySelector('.insights-card__refresh');
    expect(refreshBtn.getAttribute('aria-label')).toContain('Refresh');
    expect(refreshBtn.tagName).toBe('BUTTON');
    expect(refreshBtn.getAttribute('type')).toBe('button');
  });
});
