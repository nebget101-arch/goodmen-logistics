/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AgreementListComponent } from './agreement-list.component';
import { AgreementService } from '../agreement.service';
import { AgreementTemplate } from '../agreement.model';

function template(overrides: Partial<AgreementTemplate> = {}): AgreementTemplate {
  return {
    id: 't1',
    name: 'Motor Carrier Lease',
    documentType: 'lease_agreement',
    pageCount: 3,
    status: 'draft',
    createdAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('AgreementListComponent (FN-1837)', () => {
  let fixture: ComponentFixture<AgreementListComponent>;
  let component: AgreementListComponent;
  let serviceStub: jasmine.SpyObj<AgreementService>;
  let routerStub: jasmine.SpyObj<Router>;

  beforeEach(() => {
    serviceStub = jasmine.createSpyObj<AgreementService>('AgreementService', ['listTemplates']);
    routerStub = jasmine.createSpyObj<Router>('Router', ['navigate']);

    TestBed.configureTestingModule({
      declarations: [AgreementListComponent],
      providers: [
        { provide: AgreementService, useValue: serviceStub },
        { provide: Router, useValue: routerStub },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
  });

  function create(): void {
    fixture = TestBed.createComponent(AgreementListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // triggers ngOnInit → load()
  }

  it('loads the tenant templates on init', () => {
    const rows = [template(), template({ id: 't2', status: 'ready' })];
    serviceStub.listTemplates.and.returnValue(of(rows));
    create();
    expect(serviceStub.listTemplates).toHaveBeenCalledTimes(1);
    expect(component.templates).toEqual(rows);
    expect(component.loading).toBeFalse();
    expect(component.error).toBe('');
  });

  it('renders the empty state when there are no templates', () => {
    serviceStub.listTemplates.and.returnValue(of([]));
    create();
    expect(component.templates.length).toBe(0);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.state-card.empty')).toBeTruthy();
  });

  it('surfaces an error and clears loading when the list call fails', () => {
    serviceStub.listTemplates.and.returnValue(throwError(() => new Error('boom')));
    create();
    expect(component.error).toContain('Failed to load');
    expect(component.loading).toBeFalse();
    expect(component.templates.length).toBe(0);
  });

  it('routes a draft template to the review step', () => {
    serviceStub.listTemplates.and.returnValue(of([]));
    create();
    component.open(template({ id: 'd1', status: 'draft' }));
    expect(routerStub.navigate).toHaveBeenCalledWith(['/agreements', 'd1', 'review']);
  });

  it('routes a ready template to the placement step', () => {
    serviceStub.listTemplates.and.returnValue(of([]));
    create();
    component.open(template({ id: 'r1', status: 'ready' }));
    expect(routerStub.navigate).toHaveBeenCalledWith(['/agreements', 'r1', 'placement']);
  });

  it('routes to the upload flow on uploadNew', () => {
    serviceStub.listTemplates.and.returnValue(of([]));
    create();
    component.uploadNew();
    expect(routerStub.navigate).toHaveBeenCalledWith(['/agreements', 'new']);
  });

  it('humanizes snake_case document types', () => {
    serviceStub.listTemplates.and.returnValue(of([]));
    create();
    expect(component.formatDocumentType('lease_agreement')).toBe('Lease Agreement');
    expect(component.formatDocumentType('')).toBe('—');
  });
});
