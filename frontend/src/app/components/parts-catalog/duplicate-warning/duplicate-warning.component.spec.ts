import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';

import {
  DuplicateCandidate,
  DuplicateWarningComponent,
} from './duplicate-warning.component';

function makeCandidate(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  return {
    id: 'p-1',
    name: 'Oil Filter',
    sku: 'OIL-001',
    manufacturer: 'Fleetguard',
    similarity: 0.92,
    ...overrides,
  };
}

describe('DuplicateWarningComponent', () => {
  let fixture: ComponentFixture<DuplicateWarningComponent>;
  let component: DuplicateWarningComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [DuplicateWarningComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DuplicateWarningComponent);
    component = fixture.componentInstance;
  });

  it('renders nothing when candidates is empty', () => {
    component.candidates = [];
    fixture.detectChanges();
    const root = fixture.nativeElement.querySelector('.dup-warning');
    expect(root).toBeNull();
  });

  it('renders one row per candidate with similarity %', () => {
    component.candidates = [
      makeCandidate({ id: 'a', name: 'Oil Filter A', sku: 'A-1', similarity: 0.92 }),
      makeCandidate({ id: 'b', name: 'Oil Filter B', sku: 'B-2', similarity: 0.88 }),
    ];
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.dup-warning__row');
    expect(rows.length).toBe(2);
    const html = fixture.nativeElement.innerHTML;
    expect(html).toContain('Oil Filter A');
    expect(html).toContain('Oil Filter B');
    expect(html).toContain('92%');
    expect(html).toContain('88%');
  });

  it('emits editExisting with the candidate when "Edit existing" is clicked', () => {
    const cand = makeCandidate();
    component.candidates = [cand];
    fixture.detectChanges();

    const received: DuplicateCandidate[] = [];
    component.editExisting.subscribe(c => received.push(c));

    const btn = fixture.nativeElement.querySelector('.dup-warning__edit-link') as HTMLButtonElement;
    btn.click();

    expect(received.length).toBe(1);
    expect(received[0]).toBe(cand);
  });

  it('emits dismissed (no payload) when "Ignore — this is a new part" is clicked', () => {
    component.candidates = [makeCandidate()];
    fixture.detectChanges();

    let count = 0;
    component.dismissed.subscribe(() => count++);

    const btn = fixture.nativeElement.querySelector('.dup-warning__dismiss') as HTMLButtonElement;
    btn.click();

    expect(count).toBe(1);
  });

  it('similarityPercent rounds and clamps to [0, 100]', () => {
    expect(component.similarityPercent(0.926)).toBe(93);
    expect(component.similarityPercent(0)).toBe(0);
    expect(component.similarityPercent(-1)).toBe(0);
    expect(component.similarityPercent(2)).toBe(100);
    expect(component.similarityPercent(NaN as unknown as number)).toBe(0);
  });
});
