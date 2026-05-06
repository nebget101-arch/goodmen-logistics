import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouteCellComponent } from './route-cell.component';

describe('RouteCellComponent (FN-1353)', () => {
  let fixture: ComponentFixture<RouteCellComponent>;
  let component: RouteCellComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [RouteCellComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RouteCellComponent);
    component = fixture.componentInstance;
  });

  it('formats "City, ST" when both city and state are provided', () => {
    expect(component.format({ city: 'Kansas City', state: 'MO' })).toBe('Kansas City, MO');
  });

  it('returns city only when state is missing', () => {
    expect(component.format({ city: 'Denver', state: null })).toBe('Denver');
  });

  it('returns state only when city is missing', () => {
    expect(component.format({ city: null, state: 'CO' })).toBe('CO');
  });

  it('returns em-dash when both city and state are empty/null', () => {
    expect(component.format({ city: null, state: null })).toBe('—');
    expect(component.format({})).toBe('—');
    expect(component.format(null)).toBe('—');
  });

  it('renders pickup → delivery in DOM', () => {
    component.pickup = { city: 'Kansas City', state: 'MO' };
    component.delivery = { city: 'Denver', state: 'CO' };
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent || '';
    expect(txt).toContain('Kansas City, MO');
    expect(txt).toContain('Denver, CO');
  });
});
