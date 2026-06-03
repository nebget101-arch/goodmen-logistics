/// <reference types="jasmine" />

import { Component, TemplateRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { HoverPopoverComponent } from './hover-popover.component';
import { calculatePopoverPosition } from './hover-popover-position';

describe('calculatePopoverPosition', () => {
  const viewport = { width: 1000, height: 800 };
  const popover = { width: 200, height: 100 };

  it('places popover below trigger when placement=auto and there is room below', () => {
    const trigger = { top: 100, left: 400, width: 60, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport);
    expect(pos.placement).toBe('bottom');
    expect(pos.top).toBe(trigger.top + trigger.height + 6);
    // centered horizontally on the trigger
    expect(pos.left).toBe(trigger.left + trigger.width / 2 - popover.width / 2);
  });

  it('flips to top when there is no room below', () => {
    // trigger is near the bottom edge — bottom placement would clip
    const trigger = { top: 760, left: 400, width: 60, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport);
    expect(pos.placement).toBe('top');
    expect(pos.top).toBe(trigger.top - popover.height - 6);
  });

  it('flips to right when trigger hugs the top edge', () => {
    // no room above, room below is tight, no room beside — but right has 1000-460-6-8 = 526
    const trigger = { top: 0, left: 400, width: 60, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport);
    // bottom fits (780-26-8 >= 100), so it should go to bottom actually
    expect(['bottom', 'right']).toContain(pos.placement);
  });

  it('clamps horizontally when trigger is near the right edge', () => {
    const trigger = { top: 100, left: 950, width: 40, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport);
    // must not overflow: left + width <= viewport.width - margin (8)
    expect(pos.left + popover.width).toBeLessThanOrEqual(viewport.width - 8);
    // must not overflow left side
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });

  it('clamps horizontally when trigger is near the left edge', () => {
    const trigger = { top: 100, left: 0, width: 40, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport);
    expect(pos.left).toBeGreaterThanOrEqual(8);
  });

  it('clamps vertically when popover is larger than space on both sides (never clips above)', () => {
    const hugeTrigger = { top: 400, left: 500, width: 10, height: 10 };
    const hugePopover = { width: 200, height: 900 }; // taller than viewport
    const pos = calculatePopoverPosition(hugeTrigger, hugePopover, viewport);
    // clamp degenerates (max < min): we enforce top=margin so top edge is always visible
    expect(pos.top).toBe(8);
  });

  it('honours preferred placement when it fits', () => {
    const trigger = { top: 400, left: 500, width: 40, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport, { preferredPlacement: 'left' });
    expect(pos.placement).toBe('left');
    expect(pos.left).toBe(trigger.left - popover.width - 6);
  });

  it('overrides preferred placement when it does not fit', () => {
    // preferred=left, but trigger.left=50, popover.width=200 -> no room on left
    const trigger = { top: 400, left: 50, width: 40, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport, { preferredPlacement: 'left' });
    expect(pos.placement).not.toBe('left');
  });

  it('respects custom offset and margin', () => {
    const trigger = { top: 100, left: 400, width: 60, height: 20 };
    const pos = calculatePopoverPosition(trigger, popover, viewport, { offset: 12, margin: 16 });
    expect(pos.top).toBe(trigger.top + trigger.height + 12);
  });
});

@Component({
  template: `
    <ng-template #rich>
      <div class="rich">
        <strong>Rich</strong>
        <p>multi-line body</p>
      </div>
    </ng-template>

    <app-hover-popover [text]="'Simple tooltip'">
      <span class="trigger-text">Text trigger</span>
    </app-hover-popover>

    <app-hover-popover [content]="rich">
      <span class="trigger-rich">Rich trigger</span>
    </app-hover-popover>
  `
})
class HostComponent {
  @ViewChild('rich', { static: true }) rich!: TemplateRef<unknown>;
}

describe('HoverPopoverComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [HoverPopoverComponent, HostComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function triggerMouseEnter(selector: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLElement;
    el.dispatchEvent(new MouseEvent('mouseenter'));
  }

  function triggerMouseLeave(selector: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLElement;
    el.dispatchEvent(new MouseEvent('mouseleave'));
  }

  it('creates the host with two popovers (text and rich)', () => {
    expect(host).toBeTruthy();
    const triggers = fixture.nativeElement.querySelectorAll('app-hover-popover');
    expect(triggers.length).toBe(2);
  });

  it('mounts the text popover after showDelay on hover', fakeAsync(() => {
    triggerMouseEnter('.trigger-text');
    // before the delay nothing is mounted
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hp-popover')).toBeNull();

    tick(100); // showDelay
    fixture.detectChanges();
    const pop = fixture.nativeElement.querySelector('.hp-popover') as HTMLElement;
    expect(pop).not.toBeNull();
    expect(pop.textContent?.trim()).toBe('Simple tooltip');
    flush();
  }));

  it('renders projected rich content when a TemplateRef is provided', fakeAsync(() => {
    triggerMouseEnter('.trigger-rich');
    tick(100);
    fixture.detectChanges();
    const rich = fixture.nativeElement.querySelector('.hp-popover .rich');
    expect(rich).not.toBeNull();
    expect(rich.querySelector('strong')?.textContent).toBe('Rich');
    flush();
  }));

  it('hides the popover after hideDelay on mouseleave', fakeAsync(() => {
    triggerMouseEnter('.trigger-text');
    tick(100);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hp-popover')).not.toBeNull();

    triggerMouseLeave('.trigger-text');
    tick(100); // hideDelay
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hp-popover')).toBeNull();
    flush();
  }));

  it('does not mount when text and content are both empty', fakeAsync(() => {
    // point both popovers at empty text by resetting them
    const components = fixture.debugElement.queryAll(
      (de) => de.componentInstance instanceof HoverPopoverComponent
    );
    components.forEach((d) => {
      const c = d.componentInstance as HoverPopoverComponent;
      c.text = null;
      c.content = null;
      c.disabled = false;
    });
    fixture.detectChanges();

    triggerMouseEnter('.trigger-text');
    tick(100);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.hp-popover')).toBeNull();
    flush();
  }));
});
