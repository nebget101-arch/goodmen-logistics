/// <reference types="jasmine" />

import { of, throwError } from 'rxjs';

import { VehicleFormComponent } from './vehicle-form.component';
import { VehicleReadiness } from '../../../services/vehicle.service';

/**
 * FN-1784 — unit coverage for the activation gate and the readiness checklist.
 * The component is instantiated directly with mocked services so the suite
 * exercises pure gating/derivation logic without compiling the modal template
 * (which pulls in app-ai-select / app-ai-date-picker child components).
 */
describe('VehicleFormComponent (FN-1784 readiness gate)', () => {
  let component: VehicleFormComponent;
  let apiServiceMock: any;
  let vehicleServiceMock: any;

  const truckReadiness: VehicleReadiness = {
    vehicleId: 'v1',
    vehicleType: 'truck',
    ready: false,
    requiredDocuments: ['registration', 'insurance', 'inspection', 'ifta'],
    missing: ['ifta'],
    expired: ['inspection']
  };

  function seedValidTruck(): void {
    component.formData = {
      ...component.formData,
      unit_number: '1234',
      vin: '1FUJGLDR0CLBP8834',
      make: 'Freightliner',
      model: 'Cascadia',
      year: 2022,
      license_plate: 'ABC123',
      state: 'TX',
      status: 'in-service',
      vehicle_type: 'truck',
      ownership_type: 'company'
    };
  }

  beforeEach(() => {
    apiServiceMock = {
      createVehicle: jasmine.createSpy('createVehicle').and.returnValue(of({ id: 'v1' })),
      updateVehicle: jasmine.createSpy('updateVehicle').and.returnValue(of({ id: 'v1' }))
    };
    vehicleServiceMock = {
      getReadiness: jasmine.createSpy('getReadiness').and.returnValue(of(truckReadiness))
    };
    component = new VehicleFormComponent(apiServiceMock, vehicleServiceMock);
  });

  it('includes IFTA in the document types', () => {
    expect(component.documentTypes.some(d => d.value === 'ifta')).toBeTrue();
  });

  describe('loadReadiness', () => {
    it('fetches readiness for an existing unit and stores it', () => {
      component.formData.id = 'v1';
      component.loadReadiness();
      expect(vehicleServiceMock.getReadiness).toHaveBeenCalledWith('v1');
      expect(component.readiness?.ready).toBeFalse();
      expect(component.readinessDocuments).toEqual(truckReadiness.requiredDocuments);
    });

    it('skips the call for a brand-new unit with no id', () => {
      component.formData.id = undefined;
      component.vehicle = null;
      component.loadReadiness();
      expect(vehicleServiceMock.getReadiness).not.toHaveBeenCalled();
      expect(component.readiness).toBeNull();
    });

    it('clears readiness silently when the request errors', () => {
      vehicleServiceMock.getReadiness.and.returnValue(throwError(() => new Error('boom')));
      component.formData.id = 'v1';
      component.loadReadiness();
      expect(component.readiness).toBeNull();
      expect(component.readinessLoading).toBeFalse();
    });
  });

  describe('getRequiredDocState', () => {
    beforeEach(() => {
      component.formData.id = 'v1';
      component.loadReadiness();
    });

    it('reports expired documents', () => {
      expect(component.getRequiredDocState('inspection')).toBe('expired');
    });

    it('reports missing documents', () => {
      expect(component.getRequiredDocState('ifta')).toBe('missing');
    });

    it('reports valid documents', () => {
      expect(component.getRequiredDocState('registration')).toBe('valid');
      expect(component.getRequiredDocState('insurance')).toBe('valid');
    });
  });

  describe('blockInService', () => {
    it('is false until readiness loads', () => {
      expect(component.blockInService).toBeFalse();
    });

    it('is true when readiness reports not ready', () => {
      component.formData.id = 'v1';
      component.loadReadiness();
      expect(component.blockInService).toBeTrue();
    });

    it('is false when readiness reports ready', () => {
      vehicleServiceMock.getReadiness.and.returnValue(
        of({ ...truckReadiness, ready: true, missing: [], expired: [] })
      );
      component.formData.id = 'v1';
      component.loadReadiness();
      expect(component.blockInService).toBeFalse();
    });
  });

  describe('onSubmit gating', () => {
    it('blocks saving In Service when the unit is not ready', () => {
      seedValidTruck();
      component.formData.id = 'v1';
      component.isEditMode = true;
      component.loadReadiness(); // not ready
      component.onSubmit();
      expect(component.errors.readiness).toBeTruthy();
      expect(apiServiceMock.updateVehicle).not.toHaveBeenCalled();
    });

    it('allows saving Out of Service even when not ready', () => {
      seedValidTruck();
      component.formData.status = 'out-of-service';
      component.loadReadiness();
      component.onSubmit();
      expect(component.errors.readiness).toBeFalsy();
      expect(apiServiceMock.createVehicle).toHaveBeenCalled();
    });

    it('allows saving In Service when ready', () => {
      vehicleServiceMock.getReadiness.and.returnValue(
        of({ ...truckReadiness, ready: true, missing: [], expired: [] })
      );
      seedValidTruck();
      component.formData.id = 'v1';
      component.isEditMode = true;
      component.loadReadiness();
      component.onSubmit();
      expect(apiServiceMock.updateVehicle).toHaveBeenCalled();
    });
  });

  describe('422 VEHICLE_NOT_READY handling', () => {
    it('surfaces the missing/expired docs from the backend response', () => {
      apiServiceMock.createVehicle.and.returnValue(
        throwError(() => ({
          status: 422,
          error: { code: 'VEHICLE_NOT_READY', message: 'not ready', missing: ['ifta'], expired: ['inspection'] }
        }))
      );
      seedValidTruck();
      // readiness starts null (fresh component) → client gate passes, the
      // backend 422 is the backstop that populates it.
      component.onSubmit();
      expect(component.readiness).not.toBeNull();
      expect(component.readiness?.ready).toBeFalse();
      expect(component.readiness?.missing).toContain('ifta');
      expect(component.readiness?.expired).toContain('inspection');
      expect(component.errors.readiness).toBeTruthy();
      expect(component.errors.submit).toBeFalsy();
    });

    it('falls back to the generic submit error for non-readiness failures', () => {
      apiServiceMock.createVehicle.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'server boom' } }))
      );
      seedValidTruck();
      component.formData.status = 'out-of-service';
      component.onSubmit();
      expect(component.errors.submit).toBe('server boom');
      expect(component.errors.readiness).toBeFalsy();
    });
  });

  describe('readinessDocLabel', () => {
    it('uppercases IFTA and reuses upload labels', () => {
      expect(component.readinessDocLabel('ifta')).toBe('IFTA');
      expect(component.readinessDocLabel('inspection')).toBe('Annual Inspection');
    });
  });
});
