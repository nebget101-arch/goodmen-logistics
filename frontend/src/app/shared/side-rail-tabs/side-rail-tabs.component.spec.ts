import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SideRailTabsComponent, RailTab } from './side-rail-tabs.component';

@Component({
  template: `
    <app-side-rail-tabs [tabs]="tabs" [(activeKey)]="active">
      <div data-rail-pane="one" id="pane-one">Pane One</div>
      <div data-rail-pane="two" id="pane-two">Pane Two</div>
    </app-side-rail-tabs>
  `,
})
class HostComponent {
  tabs: RailTab[] = [
    { key: 'one', label: 'One' },
    { key: 'two', label: 'Two' },
  ];
  active = 'one';
}

describe('SideRailTabsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [SideRailTabsComponent, HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders one tab per entry with role="tab"', () => {
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
  });

  it('shows only the active pane and hides the rest', () => {
    const paneOne: HTMLElement = fixture.nativeElement.querySelector('#pane-one');
    const paneTwo: HTMLElement = fixture.nativeElement.querySelector('#pane-two');
    expect(paneOne.style.display).toBe('');
    expect(paneTwo.style.display).toBe('none');
  });

  it('clicking a tab swaps the visible pane and emits via two-way binding', () => {
    const tabs: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]')
    );
    tabs[1].click();
    fixture.detectChanges();

    const paneOne: HTMLElement = fixture.nativeElement.querySelector('#pane-one');
    const paneTwo: HTMLElement = fixture.nativeElement.querySelector('#pane-two');
    expect(host.active).toBe('two');
    expect(paneOne.style.display).toBe('none');
    expect(paneTwo.style.display).toBe('');
  });

  it('marks the active tab with aria-selected', () => {
    const tabs: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]')
    );
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });
});
