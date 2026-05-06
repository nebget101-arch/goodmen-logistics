import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { CompanySwitcherComponent, CompanySwitcherEntity } from './company-switcher.component';

describe('CompanySwitcherComponent', () => {
  let fixture: ComponentFixture<CompanySwitcherComponent>;
  let component: CompanySwitcherComponent;

  const sample: CompanySwitcherEntity[] = [
    { id: 'e1', name: 'Goodmen Logistics', mcNumber: '13212' },
    { id: 'e2', name: 'Acme Trucking Co', mcNumber: '99887' },
    { id: 'e3', name: 'Ridgeline Freight', mcNumber: null }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [CompanySwitcherComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CompanySwitcherComponent);
    component = fixture.componentInstance;
  });

  function setEntities(entities: CompanySwitcherEntity[], opts: Partial<{
    selectedEntityId: string | null;
    showAllEntities: boolean;
    loading: boolean;
    compact: boolean;
  }> = {}): void {
    component.entities = entities;
    component.selectedEntityId = opts.selectedEntityId ?? null;
    component.showAllEntities = !!opts.showAllEntities;
    component.loading = !!opts.loading;
    component.compact = !!opts.compact;
    component.ngOnChanges({
      entities: { currentValue: entities, previousValue: [], firstChange: true, isFirstChange: () => true },
      selectedEntityId: { currentValue: component.selectedEntityId, previousValue: null, firstChange: true, isFirstChange: () => true },
      showAllEntities: { currentValue: component.showAllEntities, previousValue: false, firstChange: true, isFirstChange: () => true },
      loading: { currentValue: component.loading, previousValue: false, firstChange: true, isFirstChange: () => true },
      compact: { currentValue: component.compact, previousValue: false, firstChange: true, isFirstChange: () => true }
    } as any);
    fixture.detectChanges();
  }

  it('builds rows from entities and resolves selected row', () => {
    setEntities(sample, { selectedEntityId: 'e2' });
    expect(component.rows.length).toBe(3);
    expect(component.selectedRow?.id).toBe('e2');
    expect(component.selectedRow?.name).toBe('Acme Trucking Co');
  });

  it('prepends an "All Entities" row when showAllEntities is true', () => {
    setEntities(sample, { showAllEntities: true });
    expect(component.rows[0].id).toBe('all');
    expect(component.rows[0].isAllEntities).toBeTrue();
    expect(component.rows.length).toBe(4);
  });

  it('treats single-entity case as read-only', () => {
    setEntities([sample[0]]);
    expect(component.isReadOnly).toBeTrue();
  });

  it('treats loading state as read-only and prevents opening', () => {
    setEntities(sample, { loading: true });
    expect(component.isReadOnly).toBeTrue();
    component.openPopover();
    expect(component.open).toBeFalse();
  });

  it('filters by name (case-insensitive)', () => {
    setEntities(sample);
    component.openPopover();
    component.onSearchChange('acme');
    expect(component.filteredRows.length).toBe(1);
    expect(component.filteredRows[0].id).toBe('e2');
  });

  it('filters by MC number', () => {
    setEntities(sample);
    component.openPopover();
    component.onSearchChange('99887');
    expect(component.filteredRows.length).toBe(1);
    expect(component.filteredRows[0].id).toBe('e2');
  });

  it('emits entitySelected with row id when selected', () => {
    setEntities(sample);
    const spy = spyOn(component.entitySelected, 'emit');
    component.openPopover();
    component.onSelectRow(component.rows[1]);
    expect(spy).toHaveBeenCalledWith('e2');
    expect(component.open).toBeFalse();
  });

  it('navigates with ArrowDown/ArrowUp/Home/End', () => {
    setEntities(sample);
    component.openPopover();
    component.activeIndex = 0;
    component.onListKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(component.activeIndex).toBe(1);
    component.onListKeydown(new KeyboardEvent('keydown', { key: 'End' }));
    expect(component.activeIndex).toBe(2);
    component.onListKeydown(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(component.activeIndex).toBe(0);
    component.onListKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(component.activeIndex).toBe(0);
  });
});
