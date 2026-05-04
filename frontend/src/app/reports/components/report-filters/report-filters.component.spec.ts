/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Subject, throwError } from 'rxjs';

import { ReportFiltersComponent } from './report-filters.component';
import { ReportsService } from '../../services/reports.service';
import { NlParseResponse } from '../../reports.models';

describe('ReportFiltersComponent (FN-1142 NL input)', () => {
  let fixture: ComponentFixture<ReportFiltersComponent>;
  let component: ReportFiltersComponent;
  let parseSubject: Subject<NlParseResponse>;
  let reportsServiceStub: { parseNlQuery: jasmine.Spy };

  beforeEach(async () => {
    parseSubject = new Subject<NlParseResponse>();
    reportsServiceStub = {
      parseNlQuery: jasmine.createSpy('parseNlQuery').and.returnValue(parseSubject.asObservable())
    };

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [ReportFiltersComponent],
      providers: [{ provide: ReportsService, useValue: reportsServiceStub }],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ReportFiltersComponent);
    component = fixture.componentInstance;
    component.reportKey = 'revenue-by-dispatcher';
    fixture.detectChanges();
  });

  it('renders the NL input only when reportKey is set', () => {
    component.reportKey = undefined;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#reportFilterNl')).toBeNull();

    component.reportKey = 'overview';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#reportFilterNl')).not.toBeNull();
  });

  it('does nothing when query is empty or whitespace', () => {
    component.nlQuery = '   ';
    component.onNlSubmit();
    expect(reportsServiceStub.parseNlQuery).not.toHaveBeenCalled();
    expect(component.nlLoading).toBeFalse();
  });

  it('parse success: applies returned filters and emits apply', fakeAsync(() => {
    const applySpy = spyOn(component.apply, 'emit');
    component.nlQuery = 'revenue last month';
    component.localFilters = { location_id: 'L-1' };
    component.onNlSubmit();
    expect(component.nlLoading).toBeTrue();
    expect(reportsServiceStub.parseNlQuery).toHaveBeenCalledWith(
      'revenue-by-dispatcher',
      'revenue last month',
      { location_id: 'L-1' }
    );

    parseSubject.next({
      filters: { startDate: '2026-04-01', endDate: '2026-04-30' },
      unmatchedTokens: [],
      confidence: 0.9
    });
    parseSubject.complete();
    tick();

    expect(component.nlLoading).toBeFalse();
    expect(component.nlError).toBeNull();
    expect(component.unmatchedTokens).toEqual([]);
    expect(component.localFilters).toEqual({
      location_id: 'L-1',
      startDate: '2026-04-01',
      endDate: '2026-04-30'
    });
    expect(applySpy).toHaveBeenCalledWith({
      location_id: 'L-1',
      startDate: '2026-04-01',
      endDate: '2026-04-30'
    });
  }));

  it('partial match: surfaces unmatched tokens and still applies matched filters', fakeAsync(() => {
    const applySpy = spyOn(component.apply, 'emit');
    component.nlQuery = 'revenue last month exclude team leads';
    component.onNlSubmit();

    parseSubject.next({
      filters: { startDate: '2026-04-01', endDate: '2026-04-30' },
      unmatchedTokens: ['team leads'],
      confidence: 0.55
    });
    parseSubject.complete();
    tick();

    expect(component.unmatchedTokens).toEqual(['team leads']);
    expect(component.localFilters.startDate).toBe('2026-04-01');
    expect(applySpy).toHaveBeenCalled();

    fixture.detectChanges();
    const tokens = fixture.nativeElement.querySelectorAll('.nl-token');
    expect(tokens.length).toBe(1);
    expect((tokens[0] as HTMLElement).textContent).toContain('team leads');
  }));

  it('error handling: shows error message and clears loading without emitting apply', fakeAsync(() => {
    const applySpy = spyOn(component.apply, 'emit');
    reportsServiceStub.parseNlQuery.and.returnValue(throwError(() => ({ error: { message: 'Parse failed' } })));

    component.nlQuery = 'gibberish';
    component.onNlSubmit();
    tick();

    expect(component.nlLoading).toBeFalse();
    expect(component.nlError).toBe('Parse failed');
    expect(applySpy).not.toHaveBeenCalled();

    fixture.detectChanges();
    const errEl = fixture.nativeElement.querySelector('.nl-error');
    expect(errEl).not.toBeNull();
    expect((errEl as HTMLElement).textContent).toContain('Parse failed');
  }));

  it('falls back to a generic error message when server returns no message', fakeAsync(() => {
    reportsServiceStub.parseNlQuery.and.returnValue(throwError(() => ({})));
    component.nlQuery = 'gibberish';
    component.onNlSubmit();
    tick();
    expect(component.nlError).toBe('Could not parse query. Try simpler wording.');
  }));

  it('clear() resets NL state', () => {
    component.nlQuery = 'something';
    component.nlError = 'oops';
    component.unmatchedTokens = ['foo'];
    component.onClear();
    expect(component.nlQuery).toBe('');
    expect(component.nlError).toBeNull();
    expect(component.unmatchedTokens).toEqual([]);
  });
});
