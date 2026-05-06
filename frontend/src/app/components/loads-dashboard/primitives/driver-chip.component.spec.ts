import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { DriverChipComponent } from './driver-chip.component';

describe('DriverChipComponent (FN-1353)', () => {
  let fixture: ComponentFixture<DriverChipComponent>;
  let component: DriverChipComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [DriverChipComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverChipComponent);
    component = fixture.componentInstance;
  });

  it('computes 2-letter initials for full name', () => {
    component.name = 'Alice Bond';
    fixture.detectChanges();
    expect(component.initials).toBe('AB');
  });

  it('computes 1-letter initials for single-token name', () => {
    component.name = 'Cher';
    fixture.detectChanges();
    expect(component.initials).toBe('C');
  });

  it('renders an em-dash placeholder when name is empty', () => {
    component.name = '';
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent || '';
    expect(txt).toContain('—');
  });

  it('renders an em-dash placeholder when name is null', () => {
    component.name = null;
    fixture.detectChanges();
    const txt = fixture.nativeElement.textContent || '';
    expect(txt).toContain('—');
  });

  it('uses first + last initials, ignoring middle names', () => {
    component.name = 'Mary Jane Watson';
    fixture.detectChanges();
    expect(component.initials).toBe('MW');
  });
});
