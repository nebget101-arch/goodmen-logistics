/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { Observable, of, throwError } from 'rxjs';
import { MasterTypeaheadComponent } from './master-typeahead.component';
import { MasterEntity } from '../../../services/manufacturers.service';

describe('MasterTypeaheadComponent (FN-1094)', () => {
  let fixture: ComponentFixture<MasterTypeaheadComponent>;
  let component: MasterTypeaheadComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [MasterTypeaheadComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MasterTypeaheadComponent);
    component = fixture.componentInstance;
    component.entityLabel = 'manufacturer';
  });

  function setInput(value: string): void {
    component.inputText = value;
    const target = { value } as HTMLInputElement;
    component.onInput({ target } as unknown as Event);
  }

  describe('search-then-pick', () => {
    it('debounces input by 300ms before calling searchFn', fakeAsync(() => {
      const calls: string[] = [];
      component.searchFn = (q: string) => {
        calls.push(q);
        return of<MasterEntity[]>([]);
      };
      fixture.detectChanges();

      setInput('a');
      setInput('ac');
      setInput('acm');

      tick(299);
      expect(calls.length).toBe(0);

      tick(1);
      expect(calls).toEqual(['acm']);
    }));

    it('renders search results and emits the selected master row', fakeAsync(() => {
      const rows: MasterEntity[] = [
        { id: 1, name: 'ACME Corp' },
        { id: 2, name: 'Acme Industries' },
      ];
      component.searchFn = () => of(rows);
      let emitted: { id: number | null; name: string } | undefined;
      component.valueChange.subscribe((v) => (emitted = v));
      fixture.detectChanges();

      setInput('acme');
      tick(300);
      fixture.detectChanges();

      const items = fixture.nativeElement.querySelectorAll('.typeahead-row') as NodeListOf<HTMLElement>;
      expect(items.length).toBe(2);
      expect(items[0].textContent).toContain('ACME Corp');

      // Emit the typed-text update too — final emit should be the selection.
      component.selectResult(rows[0]);
      expect(emitted).toEqual({ id: 1, name: 'ACME Corp' });
      expect(component.inputText).toBe('ACME Corp');
      expect(component.showDropdown).toBeFalse();
    }));

    it('hides "Create new" affordance when an exact case-insensitive match exists', fakeAsync(() => {
      component.searchFn = () => of<MasterEntity[]>([{ id: 7, name: 'Bosch' }]);
      fixture.detectChanges();

      setInput('bosch');
      tick(300);
      fixture.detectChanges();

      expect(component.canCreate()).toBeFalse();
      expect(fixture.nativeElement.querySelector('.typeahead-create-row')).toBeNull();
    }));
  });

  describe('create-new', () => {
    it('shows "Create new {entityLabel}: " when input has no exact match', fakeAsync(() => {
      component.searchFn = () => of<MasterEntity[]>([{ id: 1, name: 'Acme' }]);
      fixture.detectChanges();

      setInput('Bosch');
      tick(300);
      fixture.detectChanges();

      const createRow = fixture.nativeElement.querySelector('.typeahead-create-row') as HTMLElement;
      expect(createRow).toBeTruthy();
      expect(createRow.textContent).toContain('Create new manufacturer:');
      expect(createRow.textContent).toContain('"Bosch"');
    }));

    it('calls createFn, emits the new row, and closes the dropdown', fakeAsync(() => {
      component.searchFn = () => of<MasterEntity[]>([]);
      let createdWith = '';
      component.createFn = (name: string): Observable<MasterEntity> => {
        createdWith = name;
        return of({ id: 42, name } as MasterEntity);
      };
      const emits: Array<{ id: number | null; name: string }> = [];
      component.valueChange.subscribe((v) => emits.push(v));
      fixture.detectChanges();

      setInput('Fleetguard');
      tick(300);
      fixture.detectChanges();

      component.createNew();
      tick();
      fixture.detectChanges();

      expect(createdWith).toBe('Fleetguard');
      // The last emit is the newly-created selection (FK-bound).
      expect(emits[emits.length - 1]).toEqual({ id: 42, name: 'Fleetguard' });
      expect(component.showDropdown).toBeFalse();
    }));
  });

  describe('error handling', () => {
    it('surfaces a search error and exposes a retry control', fakeAsync(() => {
      let attempt = 0;
      component.searchFn = () => {
        attempt += 1;
        return attempt === 1
          ? throwError(() => ({ error: { error: 'Service unavailable' } }))
          : of<MasterEntity[]>([{ id: 5, name: 'Recovered' }]);
      };
      fixture.detectChanges();

      setInput('acme');
      tick(300);
      fixture.detectChanges();

      expect(component.error).toBe('Service unavailable');
      const retryBtn = fixture.nativeElement.querySelector('.typeahead-retry') as HTMLButtonElement;
      expect(retryBtn).toBeTruthy();

      retryBtn.click();
      tick(300);
      fixture.detectChanges();

      expect(component.error).toBeNull();
      expect(component.results).toEqual([{ id: 5, name: 'Recovered' }]);
    }));

    it('surfaces a create error without selecting anything', fakeAsync(() => {
      component.searchFn = () => of<MasterEntity[]>([]);
      component.createFn = () => throwError(() => ({ message: 'Network down' }));
      const emits: Array<{ id: number | null; name: string }> = [];
      component.valueChange.subscribe((v) => emits.push(v));
      fixture.detectChanges();

      setInput('NewCo');
      tick(300);
      fixture.detectChanges();

      const lastEmitsBefore = emits.length;
      component.createNew();
      tick();
      fixture.detectChanges();

      expect(component.error).toBe('Network down');
      expect(component.creating).toBeFalse();
      // No additional emit beyond the typed-text one.
      expect(emits.length).toBe(lastEmitsBefore);
    }));
  });

  describe('edit-flow legacy text fallback', () => {
    it('renders an existing free-text value with id=null without forcing a search', () => {
      component.value = { id: null, name: 'Legacy Manufacturer' };
      component.ngOnChanges({
        value: { currentValue: component.value, previousValue: null, firstChange: true, isFirstChange: () => true },
      });
      fixture.detectChanges();
      expect(component.inputText).toBe('Legacy Manufacturer');
      const input = fixture.nativeElement.querySelector('.typeahead-input') as HTMLInputElement;
      expect(input.value).toBe('Legacy Manufacturer');
    });
  });
});
