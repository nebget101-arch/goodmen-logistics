import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { PipelinePillComponent, PIPELINE_STAGES } from './pipeline-pill.component';

describe('PipelinePillComponent (FN-1353)', () => {
  let fixture: ComponentFixture<PipelinePillComponent>;
  let component: PipelinePillComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [PipelinePillComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PipelinePillComponent);
    component = fixture.componentInstance;
  });

  function setStatuses(load: string | null, billing: string | null) {
    component.loadStatus = load;
    component.billingStatus = billing;
    component.ngOnChanges({} as any);
    fixture.detectChanges();
  }

  it('renders 5 fixed segments in canonical order', () => {
    setStatuses('NEW', 'PENDING');
    const segs = fixture.nativeElement.querySelectorAll('.pipeline-pill__seg');
    expect(segs.length).toBe(5);
    const keys = Array.from(segs).map((el) => (el as HTMLElement).getAttribute('data-key'));
    expect(keys).toEqual(['dispatched', 'in_transit', 'delivered', 'invoiced', 'funded']);
    expect(PIPELINE_STAGES.length).toBe(5);
  });

  it('NEW + PENDING — no segment reached', () => {
    setStatuses('NEW', 'PENDING');
    expect(component.reachedIndex).toBe(-1);
    expect(component.cancelled).toBe(false);
  });

  it('DRAFT + PENDING — no segment reached', () => {
    setStatuses('DRAFT', 'PENDING');
    expect(component.reachedIndex).toBe(-1);
  });

  it('DISPATCHED + PENDING — Dispatched reached', () => {
    setStatuses('DISPATCHED', 'PENDING');
    expect(component.reachedIndex).toBe(0);
  });

  it('EN_ROUTE → In Transit reached', () => {
    setStatuses('EN_ROUTE', 'PENDING');
    expect(component.reachedIndex).toBe(1);
  });

  it('PICKED_UP → In Transit reached', () => {
    setStatuses('PICKED_UP', 'PENDING');
    expect(component.reachedIndex).toBe(1);
  });

  it('IN_TRANSIT → In Transit reached', () => {
    setStatuses('IN_TRANSIT', 'PENDING');
    expect(component.reachedIndex).toBe(1);
  });

  it('DELIVERED + BOL_RECEIVED → Delivered reached (billing not invoiced yet)', () => {
    setStatuses('DELIVERED', 'BOL_RECEIVED');
    expect(component.reachedIndex).toBe(2);
  });

  it('DELIVERED + INVOICED → Invoiced reached', () => {
    setStatuses('DELIVERED', 'INVOICED');
    expect(component.reachedIndex).toBe(3);
  });

  it('DELIVERED + SENT_TO_FACTORING → Invoiced reached', () => {
    setStatuses('DELIVERED', 'SENT_TO_FACTORING');
    expect(component.reachedIndex).toBe(3);
  });

  it('DELIVERED + FUNDED → Funded reached', () => {
    setStatuses('DELIVERED', 'FUNDED');
    expect(component.reachedIndex).toBe(4);
  });

  it('DELIVERED + PAID → Funded reached', () => {
    setStatuses('DELIVERED', 'PAID');
    expect(component.reachedIndex).toBe(4);
  });

  it('CANCELLED loadStatus → cancelled state, no reached', () => {
    setStatuses('CANCELLED', 'PENDING');
    expect(component.cancelled).toBe(true);
    expect(component.reachedIndex).toBe(-1);
    expect(fixture.nativeElement.querySelector('.pipeline-pill__slash')).toBeTruthy();
  });

  it('billingStatus CANCELLED → cancelled state', () => {
    setStatuses('DELIVERED', 'CANCELLED');
    expect(component.cancelled).toBe(true);
  });

  it('TONU loadStatus → not cancelled per scheme but no segments reached', () => {
    setStatuses('TONU', 'PENDING');
    expect(component.cancelled).toBe(false);
    expect(component.reachedIndex).toBe(-1);
  });

  it('aria-label reflects current stage and progress count', () => {
    setStatuses('IN_TRANSIT', 'PENDING');
    expect(component.ariaLabel).toBe('Pipeline: In Transit (2 of 5)');
    setStatuses('DELIVERED', 'FUNDED');
    expect(component.ariaLabel).toBe('Pipeline: Funded (5 of 5)');
  });

  it('current segment has glow class', () => {
    setStatuses('DISPATCHED', 'PENDING');
    const segs = fixture.nativeElement.querySelectorAll('.pipeline-pill__seg');
    expect((segs[0] as HTMLElement).classList.contains('pipeline-pill__seg--current')).toBe(true);
    expect((segs[1] as HTMLElement).classList.contains('pipeline-pill__seg--current')).toBe(false);
  });

  it('billing-only progress without delivered loadStatus still advances pipeline', () => {
    // Edge case: someone marked billing INVOICED before DELIVERED — we still
    // surface "Invoiced" as the highest reached.
    setStatuses('IN_TRANSIT', 'INVOICED');
    expect(component.reachedIndex).toBe(3);
  });

  it('handles null/undefined inputs without throwing', () => {
    setStatuses(null, null);
    expect(component.reachedIndex).toBe(-1);
    expect(component.cancelled).toBe(false);
  });
});
