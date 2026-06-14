// FN-1807 — component spec for the placement editor. The geometry/reducer math
// is covered exhaustively in bbox-editor.logic.spec.ts; here we cover the
// component's wiring (toolbar actions, save payload partitioning, page focus).
// The pdf.js render path is intentionally not exercised — we feed a null route
// id so ngOnInit skips load(), then drive state directly.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { AgreementPlacementComponent } from './agreement-placement.component';
import { AgreementService } from '../agreement.service';
import { addField, toPlacementFields, PageGeometry } from './bbox-editor.logic';
import { AgreementField, AgreementTemplateDetail } from '../agreement.model';

const PAGE: PageGeometry = { widthPts: 612, heightPts: 792 };

function srvField(over: Partial<AgreementField> = {}): AgreementField {
  return {
    id: 'srv-1', fieldKey: 'k', label: 'L', fieldType: 'text', page: 1,
    bbox: [72, 100, 200, 24], role: 'internal', suggestedRole: 'internal',
    confidence: 0.9, ...over,
  };
}

describe('AgreementPlacementComponent', () => {
  let fixture: ComponentFixture<AgreementPlacementComponent>;
  let component: AgreementPlacementComponent;
  let serviceSpy: jasmine.SpyObj<AgreementService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    serviceSpy = jasmine.createSpyObj('AgreementService', ['getTemplate', 'savePlacement']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    await TestBed.configureTestingModule({
      declarations: [AgreementPlacementComponent],
      imports: [FormsModule],
      providers: [
        { provide: AgreementService, useValue: serviceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgreementPlacementComponent);
    component = fixture.componentInstance;
    // ngOnInit runs with null id → load() skipped, no pdf.js import.
    fixture.detectChanges();

    // Seed editor state as if a document had loaded.
    component.pages = [PAGE];
    component.pageCount = 1;
    component.pxPerPoint = 1;
    component.fields = toPlacementFields([srvField()], component.pages);
  });

  it('creates', () => {
    expect(component).toBeTruthy();
    expect(serviceSpy.getTemplate).not.toHaveBeenCalled();
  });

  it('toggles draw mode and clears selection', () => {
    component.selectField(component.fields[0].localId);
    component.toggleDrawMode();
    expect(component.drawMode).toBe(true);
    expect(component.selectedLocalId).toBeNull();
  });

  it('deletes the selected box (tombstones an existing field)', () => {
    const id = component.fields[0].localId;
    component.selectField(id);
    component.deleteSelected();
    expect(component.fields.find((f) => f.localId === id)?.deleted).toBe(true);
    expect(component.visibleFields.length).toBe(0);
  });

  it('save with no changes shows a notice and does not call the service', () => {
    component.save(false);
    expect(serviceSpy.savePlacement).not.toHaveBeenCalled();
    expect(component.saveNotice).toContain('No placement changes');
  });

  it('save sends the partitioned payload and reloads from the response', () => {
    // Add a new box → there is now something to save.
    component.fields = addField(component.fields, {
      localId: 'n1', page: 1, bbox: [50, 50, 120, 20], pageGeom: PAGE,
    });
    const reloaded: AgreementTemplateDetail = {
      id: 't1', name: 'T', documentType: 'generic', pageCount: 1, status: 'draft',
      fields: [srvField(), srvField({ id: 'srv-2', label: 'New' })],
    };
    serviceSpy.savePlacement.and.returnValue(of(reloaded));

    component.save(false);

    expect(serviceSpy.savePlacement).toHaveBeenCalledTimes(1);
    const [, payload, finalize] = serviceSpy.savePlacement.calls.mostRecent().args;
    expect(payload.adds.length).toBe(1);
    expect(finalize).toBe(false);
    expect(component.fields.length).toBe(2); // re-seeded from response
    expect(component.saveNotice).toBe('Placement saved.');
  });

  it('save(finalize) navigates back to the list', () => {
    component.fields = addField(component.fields, {
      localId: 'n1', page: 1, bbox: [50, 50, 120, 20], pageGeom: PAGE,
    });
    serviceSpy.savePlacement.and.returnValue(
      of({ id: 't1', name: 'T', documentType: 'generic', pageCount: 1, status: 'ready', fields: [] })
    );
    component.save(true);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/agreements']);
  });

  it('focusField jumps to the field page and selects it', () => {
    component.pages = [PAGE, PAGE];
    component.pageCount = 2;
    component.fields = toPlacementFields(
      [srvField({ page: 1 }), srvField({ id: 'srv-2', page: 2 })],
      component.pages
    );
    const onP2 = component.fields[1];
    component.focusField(onP2);
    expect(component.currentPage).toBe(2);
    expect(component.selectedLocalId).toBe(onP2.localId);
  });
});
