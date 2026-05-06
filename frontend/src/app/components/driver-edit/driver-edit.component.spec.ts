import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { DriverEditComponent } from './driver-edit.component';
import { ApiService } from '../../services/api.service';

describe('DriverEditComponent', () => {
  let component: DriverEditComponent;
  let fixture: ComponentFixture<DriverEditComponent>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let routerSpy: jasmine.SpyObj<Router>;

  function createApiSpy(): jasmine.SpyObj<ApiService> {
    const spy = jasmine.createSpyObj<ApiService>('ApiService', [
      'getDriver',
      'getVehicles',
      'getDispatchDrivers',
      'getAllPayees',
      'getPayeeAssignment',
      'getExpenseResponsibility',
      'getRecurringDeductions',
      'updateDriver',
      'resolveDriverPayeeAssignment',
      'saveExpenseResponsibility',
      'createRecurringDeduction',
      'updateRecurringDeduction',
      'backfillRecurringDeductions'
    ]);
    spy.getDriver.and.returnValue(of({ id: 'd1', firstName: 'Ada', lastName: 'Lovelace', cdlNumber: 'A1', cdlState: 'CA' }));
    spy.getVehicles.and.returnValue(of([]));
    spy.getDispatchDrivers.and.returnValue(of([]));
    spy.getAllPayees.and.returnValue(of([]));
    spy.getPayeeAssignment.and.returnValue(of(null));
    spy.getExpenseResponsibility.and.returnValue(of(null));
    spy.getRecurringDeductions.and.returnValue(of([]));
    spy.updateDriver.and.returnValue(of({ id: 'd1' }));
    spy.resolveDriverPayeeAssignment.and.returnValue(of({}));
    spy.saveExpenseResponsibility.and.returnValue(of({}));
    return spy;
  }

  function setup(routeId: string | null = 'd1'): void {
    apiServiceSpy = createApiSpy();
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate', 'createUrlTree', 'serializeUrl', 'navigateByUrl']);

    TestBed.configureTestingModule({
      declarations: [DriverEditComponent],
      imports: [FormsModule],
      providers: [
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: routeId === null ? '' : routeId }))
          }
        }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });

    fixture = TestBed.createComponent(DriverEditComponent);
    component = fixture.componentInstance;
  }

  it('loads the driver and renders the form when id resolves', () => {
    setup('d1');
    fixture.detectChanges();

    expect(apiServiceSpy.getDriver).toHaveBeenCalledWith('d1');
    expect(component.loadingDriver).toBeFalse();
    expect(component.notFound).toBeFalse();
    expect(component.driver.firstName).toBe('Ada');
    expect(component.driver.lastName).toBe('Lovelace');
  });

  it('shows the not-found state when getDriver 404s', () => {
    setup('missing');
    apiServiceSpy.getDriver.and.returnValue(throwError(() => ({ status: 404 })));

    fixture.detectChanges();

    expect(component.loadingDriver).toBeFalse();
    expect(component.notFound).toBeTrue();
  });

  it('navigates back to /drivers on cancel without calling updateDriver', () => {
    setup('d1');
    fixture.detectChanges();

    component.cancel();

    expect(routerSpy.navigate).toHaveBeenCalledWith(['/drivers']);
    expect(apiServiceSpy.updateDriver).not.toHaveBeenCalled();
  });

  it('saves the driver and navigates back on success', () => {
    setup('d1');
    fixture.detectChanges();

    component.saveDriver();

    expect(apiServiceSpy.updateDriver).toHaveBeenCalledWith('d1', jasmine.any(Object));
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/drivers']);
    expect(component.saving).toBeFalse();
  });

  it('blocks save when required CDL fields are missing', () => {
    setup('d1');
    fixture.detectChanges();

    component.driver.cdlNumber = '';
    spyOn(window, 'alert');

    component.saveDriver();

    expect(window.alert).toHaveBeenCalled();
    expect(apiServiceSpy.updateDriver).not.toHaveBeenCalled();
  });
});
