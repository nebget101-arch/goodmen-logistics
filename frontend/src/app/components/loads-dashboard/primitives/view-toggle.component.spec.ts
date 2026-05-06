import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { ViewToggleComponent, LoadsViewMode } from './view-toggle.component';

describe('ViewToggleComponent (FN-1353)', () => {
  let fixture: ComponentFixture<ViewToggleComponent>;
  let component: ViewToggleComponent;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ViewToggleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ViewToggleComponent);
    component = fixture.componentInstance;
    component.value = 'cards';
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  function getTab(mode: LoadsViewMode): HTMLButtonElement {
    const tabs = host.querySelectorAll<HTMLButtonElement>('.view-toggle__tab');
    for (const t of Array.from(tabs)) {
      if ((t.textContent || '').toLowerCase().includes(mode)) {
        return t;
      }
    }
    throw new Error(`tab not found for ${mode}`);
  }

  it('renders three tabs in canonical order', () => {
    const tabs = host.querySelectorAll<HTMLButtonElement>('.view-toggle__tab');
    expect(tabs.length).toBe(3);
    expect((tabs[0].textContent || '').toLowerCase()).toContain('table');
    expect((tabs[1].textContent || '').toLowerCase()).toContain('cards');
    expect((tabs[2].textContent || '').toLowerCase()).toContain('kanban');
  });

  it('uses role=tablist and role=tab', () => {
    expect(host.querySelector('[role="tablist"]')).toBeTruthy();
    const tabRoles = host.querySelectorAll('[role="tab"]');
    expect(tabRoles.length).toBe(3);
  });

  it('aria-selected reflects active tab', () => {
    component.value = 'cards';
    fixture.detectChanges();
    expect(getTab('cards').getAttribute('aria-selected')).toBe('true');
    expect(getTab('table').getAttribute('aria-selected')).toBe('false');
    expect(getTab('kanban').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Table emits valueChange="table" and updates aria-selected', () => {
    const received: LoadsViewMode[] = [];
    component.valueChange.subscribe((v) => received.push(v));
    getTab('table').click();
    fixture.detectChanges();
    expect(received).toEqual(['table']);
    expect(getTab('table').getAttribute('aria-selected')).toBe('true');
    expect(getTab('cards').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Kanban emits valueChange="kanban"', () => {
    const received: LoadsViewMode[] = [];
    component.valueChange.subscribe((v) => received.push(v));
    getTab('kanban').click();
    expect(received).toEqual(['kanban']);
  });

  it('clicking the already-active tab does NOT emit valueChange', () => {
    const received: LoadsViewMode[] = [];
    component.valueChange.subscribe((v) => received.push(v));
    component.value = 'cards';
    fixture.detectChanges();
    getTab('cards').click();
    expect(received.length).toBe(0);
  });
});
