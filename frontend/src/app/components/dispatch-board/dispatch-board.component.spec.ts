/// <reference types="jasmine" />

import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Subject, of } from 'rxjs';

import { DispatchBoardComponent } from './dispatch-board.component';
import { LoadsService } from '../../services/loads.service';
import { ApiService } from '../../services/api.service';
import { ReferenceDataService } from '../../services/reference-data.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';
import { SafetyRiskService } from '../../safety/safety-risk.service';
import { environment } from '../../../environments/environment';

/**
 * FN-1435 — DispatchBoardComponent NLQ search bar specs.
 *
 * Covers the two acceptance scenarios called out in the implementation notes:
 *   - empty query → no HTTP call
 *   - error response → renders an error toast
 */
describe('DispatchBoardComponent — NLQ search bar (FN-1435)', () => {
  let fixture: ComponentFixture<DispatchBoardComponent>;
  let component: DispatchBoardComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    const loadsService = jasmine.createSpyObj<LoadsService>('LoadsService', ['listLoads']);
    loadsService.listLoads.and.returnValue(of({ data: [] } as any));

    const apiService = jasmine.createSpyObj<ApiService>('ApiService', ['getDispatchDrivers']);
    apiService.getDispatchDrivers.and.returnValue(of([] as any));

    const referenceDataService = jasmine.createSpyObj<ReferenceDataService>(
      'ReferenceDataService',
      ['getLoadStatusCodes', 'getBillingStatusCodes']
    );
    referenceDataService.getLoadStatusCodes.and.returnValue(of([] as any));
    referenceDataService.getBillingStatusCodes.and.returnValue(of([] as any));

    // Operating entity context never emits — keeps loadData() from running.
    const opEntityContextSubject = new Subject<any>();
    const operatingEntityContext = jasmine.createSpyObj<OperatingEntityContextService>(
      'OperatingEntityContextService',
      ['context$']
    );
    operatingEntityContext.context$.and.returnValue(opEntityContextSubject.asObservable());

    const safetyRisk = jasmine.createSpyObj<SafetyRiskService>('SafetyRiskService', ['getFleetSummary']);
    safetyRisk.getFleetSummary.and.returnValue(of({ all_scores: [] } as any));

    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [DispatchBoardComponent],
      providers: [
        { provide: LoadsService, useValue: loadsService },
        { provide: ApiService, useValue: apiService },
        { provide: ReferenceDataService, useValue: referenceDataService },
        { provide: OperatingEntityContextService, useValue: operatingEntityContext },
        { provide: SafetyRiskService, useValue: safetyRisk },
        { provide: Router, useValue: router },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DispatchBoardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('does not call /loads/search/nlq when the query is empty', () => {
    component.nlqQuery = '   ';
    component.runNlqSearch();

    httpMock.expectNone(`${environment.apiUrl}/loads/search/nlq`);
    expect(component.nlqLoading).toBeFalse();
    expect(component.nlqHasSearched).toBeFalse();
  });

  it('renders an error toast when /loads/search/nlq fails', fakeAsync(() => {
    component.nlqQuery = 'empty trucks in TX';
    component.runNlqSearch();

    const req = httpMock.expectOne(`${environment.apiUrl}/loads/search/nlq`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ query: 'empty trucks in TX' });

    req.flush({ message: 'Internal Server Error' }, { status: 500, statusText: 'Server Error' });
    tick();

    expect(component.nlqLoading).toBeFalse();
    expect(component.nlqResults).toEqual([]);
    expect(component.toast).toContain('Search failed');
    expect(component.toastType).toBe('error');
  }));
});
