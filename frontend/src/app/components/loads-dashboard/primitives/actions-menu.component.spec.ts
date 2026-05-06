import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ActionsMenuComponent } from './actions-menu.component';

describe('ActionsMenuComponent (FN-1353)', () => {
  let fixture: ComponentFixture<ActionsMenuComponent>;
  let component: ActionsMenuComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ActionsMenuComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ActionsMenuComponent);
    component = fixture.componentInstance;
    component.loadId = 'load-42';
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  function clickByText(text: string): boolean {
    const items = host.querySelectorAll<HTMLButtonElement>('.actions-menu__item');
    for (const it of Array.from(items)) {
      if ((it.textContent || '').trim().includes(text)) {
        it.click();
        return true;
      }
    }
    return false;
  }

  function openMenu(): void {
    const toggle = host.querySelector<HTMLButtonElement>('.actions-menu__toggle');
    expect(toggle).toBeTruthy();
    toggle!.click();
    fixture.detectChanges();
  }

  it('opens and closes the overflow menu when toggle is clicked', () => {
    expect(host.querySelector('.actions-menu__dropdown')).toBeNull();
    openMenu();
    expect(host.querySelector('.actions-menu__dropdown')).toBeTruthy();
    // Click again to close.
    host.querySelector<HTMLButtonElement>('.actions-menu__toggle')!.click();
    fixture.detectChanges();
    expect(host.querySelector('.actions-menu__dropdown')).toBeNull();
  });

  it('emits open with loadId when primary button is clicked', () => {
    const received: string[] = [];
    component.open.subscribe((id) => received.push(id));
    host.querySelector<HTMLButtonElement>('.actions-menu__primary')!.click();
    expect(received).toEqual(['load-42']);
  });

  it('emits edit with loadId when Edit menu item is clicked, and closes menu', () => {
    const received: string[] = [];
    component.edit.subscribe((id) => received.push(id));
    openMenu();
    expect(clickByText('Edit')).toBe(true);
    fixture.detectChanges();
    expect(received).toEqual(['load-42']);
    expect(component.menuOpen).toBe(false);
  });

  it('emits clone with loadId when Clone menu item is clicked', () => {
    const received: string[] = [];
    component.clone.subscribe((id) => received.push(id));
    openMenu();
    expect(clickByText('Clone')).toBe(true);
    expect(received).toEqual(['load-42']);
  });

  it('emits viewOnMap with loadId when View on map menu item is clicked', () => {
    const received: string[] = [];
    component.viewOnMap.subscribe((id) => received.push(id));
    openMenu();
    expect(clickByText('View on map')).toBe(true);
    expect(received).toEqual(['load-42']);
  });

  it('emits trackDriver with loadId when Track driver menu item is clicked', () => {
    const received: string[] = [];
    component.trackDriver.subscribe((id) => received.push(id));
    openMenu();
    expect(clickByText('Track driver')).toBe(true);
    expect(received).toEqual(['load-42']);
  });

  it('emits copyLink with loadId when Copy link menu item is clicked', () => {
    const received: string[] = [];
    component.copyLink.subscribe((id) => received.push(id));
    openMenu();
    expect(clickByText('Copy link')).toBe(true);
    expect(received).toEqual(['load-42']);
  });

  it('closes the menu on outside document click', () => {
    openMenu();
    expect(component.menuOpen).toBe(true);
    // Simulate clicking somewhere outside the host element.
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(component.menuOpen).toBe(false);
    document.body.removeChild(outside);
  });

  it('closes the menu on Escape', () => {
    openMenu();
    expect(component.menuOpen).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(component.menuOpen).toBe(false);
  });
});
