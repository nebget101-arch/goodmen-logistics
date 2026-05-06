import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { DispatchDriversComponent } from './dispatch-drivers.component';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

describe('DispatchDriversComponent', () => {
  let component: DispatchDriversComponent;
  let fixture: ComponentFixture<DispatchDriversComponent>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    apiServiceSpy = jasmine.createSpyObj<ApiService>('ApiService', ['getDispatchDrivers']);
    apiServiceSpy.getDispatchDrivers.and.returnValue(of([
      { id: 'd1', firstName: 'Ada', lastName: 'Lovelace', cdlNumber: 'A1', cdlState: 'CA', driverType: 'driver', status: 'active' },
      { id: 'd2', firstName: 'Grace', lastName: 'Hopper', cdlNumber: 'B2', cdlState: 'NY', driverType: 'owner_operator', status: 'inactive' }
    ]));
    routerSpy = jasmine.createSpyObj<Router>('Router', ['navigate']);

    const operatingEntityContextStub = {
      context$: () => of({ isLoaded: true, selectedOperatingEntity: { name: 'Test Co' }, selectedOperatingEntityId: 'oe1' })
    };

    TestBed.configureTestingModule({
      declarations: [DispatchDriversComponent],
      imports: [FormsModule],
      providers: [
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: OperatingEntityContextService, useValue: operatingEntityContextStub }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });

    fixture = TestBed.createComponent(DispatchDriversComponent);
    component = fixture.componentInstance;
  });

  it('loads drivers on init via the operating-entity context', () => {
    fixture.detectChanges();
    expect(apiServiceSpy.getDispatchDrivers).toHaveBeenCalled();
    expect(component.drivers.length).toBe(2);
    expect(component.loading).toBeFalse();
  });

  it('navigates to /drivers/:id/edit when goToEdit is invoked', () => {
    fixture.detectChanges();
    component.goToEdit({ id: 'd1' });
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/drivers', 'd1', 'edit']);
  });

  it('does not navigate when the driver has no id', () => {
    fixture.detectChanges();
    component.goToEdit({});
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('filters drivers by name and clears filters on demand', () => {
    fixture.detectChanges();
    component.driverFilters.name = 'ada';
    expect(component.filteredDrivers.length).toBe(1);
    expect(component.hasActiveFilter()).toBeTrue();

    component.clearFilters();
    expect(component.filteredDrivers.length).toBe(2);
    expect(component.hasActiveFilter()).toBeFalse();
  });

  it('exposes a Driver/Owner Operator label helper', () => {
    expect(component.getDriverTypeLabel('owner_operator')).toBe('Owner Operator');
    expect(component.getDriverTypeLabel('driver')).toBe('Driver');
    expect(component.getDriverTypeLabel('company')).toBe('Driver');
    expect(component.getDriverTypeLabel('')).toBe('Driver');
  });
});
