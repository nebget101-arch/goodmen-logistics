import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SummaryChipComponent } from './summary-chip.component';

describe('SummaryChipComponent', () => {
  let component: SummaryChipComponent;
  let fixture: ComponentFixture<SummaryChipComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SummaryChipComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SummaryChipComponent);
    component = fixture.componentInstance;
    component.title = 'Pickup confirmed';
    component.detail = '1200 Market St, San Francisco, CA';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the title and detail', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.summary-chip__title')?.textContent).toContain(
      'Pickup confirmed'
    );
    expect(el.querySelector('.summary-chip__detail')?.textContent).toContain(
      '1200 Market St'
    );
  });

  it('hides the edit button when not editable', () => {
    expect(fixture.nativeElement.querySelector('.summary-chip__edit')).toBeNull();
  });

  it('shows the edit button and emits edit when editable', () => {
    component.editable = true;
    fixture.detectChanges();
    spyOn(component.edit, 'emit');
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.summary-chip__edit'
    );
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Edit');
    btn.click();
    expect(component.edit.emit).toHaveBeenCalled();
  });
});
