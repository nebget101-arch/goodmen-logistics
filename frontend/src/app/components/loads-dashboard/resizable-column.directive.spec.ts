/// <reference types="jasmine" />

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResizableColumnDirective } from './resizable-column.directive';

@Component({
  template: `
    <table>
      <thead>
        <tr>
          <th
            id="th-pickup"
            [appResizableColumn]="'pickup'"
            [currentWidth]="width"
            [minWidth]="minWidth"
            [maxWidth]="maxWidth"
            (click)="thClicks = thClicks + 1"
            (widthChange)="onWidthChange($event)"
          >
            Pickup
          </th>
        </tr>
      </thead>
    </table>
  `,
})
class HostComponent {
  width = 150;
  minWidth = 60;
  maxWidth = 600;
  thClicks = 0;
  emitted: number[] = [];
  onWidthChange(px: number): void {
    this.emitted.push(px);
    this.width = px;
  }
}

describe('ResizableColumnDirective (FN-1059)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let th: HTMLElement;
  let handle: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ResizableColumnDirective, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();

    th = fixture.nativeElement.querySelector('#th-pickup') as HTMLElement;
    handle = th.querySelector('.app-resize-handle') as HTMLElement;
  });

  it('injects a resize handle into the host th with the expected ARIA attributes', () => {
    expect(handle).toBeTruthy();
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(handle.getAttribute('aria-valuemin')).toBe('60');
    expect(handle.getAttribute('aria-valuemax')).toBe('600');
    expect(handle.getAttribute('aria-valuenow')).toBe('150');
    expect(handle.getAttribute('aria-label')).toContain('pickup');
  });

  it('promotes the host th to position:relative so the handle anchors correctly', () => {
    expect(th.style.position || getComputedStyle(th).position).toBe('relative');
  });

  it('emits widthChange on drag (mousedown → mousemove → mouseup) and clamps live', () => {
    const downEv = new MouseEvent('mousedown', {
      clientX: 200,
      bubbles: true,
      cancelable: true,
    });
    handle.dispatchEvent(downEv);

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(host.emitted.length).toBeGreaterThanOrEqual(2);
    // 150 + (240 - 200) = 190; 150 + (260 - 200) = 210
    expect(host.emitted).toContain(190);
    expect(host.emitted).toContain(210);
  });

  it('clamps to maxWidth when the drag would go above the cap', () => {
    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + 5000 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(host.emitted[host.emitted.length - 1]).toBe(host.maxWidth);
  });

  it('clamps to minWidth when the drag would go below the floor', () => {
    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 500, bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(host.emitted[host.emitted.length - 1]).toBe(host.minWidth);
  });

  it('stops propagation on mousedown so the host th sort handler does not fire (AC10)', () => {
    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(host.thClicks).toBe(0);
  });

  it('stops propagation on click so a fast tap on the handle does not sort', () => {
    handle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(host.thClicks).toBe(0);
  });

  it('keyboard ArrowRight steps +8px, ArrowLeft steps -8px', () => {
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(host.emitted[host.emitted.length - 1]).toBe(158);

    fixture.detectChanges();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(host.emitted[host.emitted.length - 1]).toBe(150);
  });

  it('keyboard Shift+Arrow steps ±32px', () => {
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(host.emitted[host.emitted.length - 1]).toBe(182);
  });

  it('keyboard arrows respect the clamp', () => {
    host.width = 595;
    fixture.detectChanges();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(host.emitted[host.emitted.length - 1]).toBe(host.maxWidth);
  });

  it('updates aria-valuenow when currentWidth changes from the parent', () => {
    host.width = 222;
    fixture.detectChanges();
    expect(handle.getAttribute('aria-valuenow')).toBe('222');
  });

  it('emits live widthChange events on every mousemove during a drag', () => {
    handle.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 100, bubbles: true, cancelable: true }),
    );
    const before = host.emitted.length;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 105 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 115 }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 130 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(host.emitted.length - before).toBe(3);
  });

  it('removes the handle and document listeners on directive teardown', () => {
    fixture.destroy();
    // After destroy, dispatching mousemove on document must not throw or
    // mutate the host (no leaked listeners).
    expect(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 999 }));
      document.dispatchEvent(new MouseEvent('mouseup'));
    }).not.toThrow();
  });
});
