/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AiSegmentedControlComponent } from './ai-segmented-control.component';

describe('AiSegmentedControlComponent (FN-1636)', () => {
  let fixture: ComponentFixture<AiSegmentedControlComponent>;
  let component: AiSegmentedControlComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiSegmentedControlComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(AiSegmentedControlComponent);
    component = fixture.componentInstance;
    component.segments = [
      { key: 'today', label: 'Today' },
      { key: '7d', label: '7D' },
      { key: '30d', label: '30D' }
    ];
    component.selectedKey = 'today';
    fixture.detectChanges();
  });

  it('renders one button per segment', () => {
    expect(fixture.nativeElement.querySelectorAll('.seg-btn').length).toBe(3);
  });

  it('sets aria-pressed=true only on the selected segment', () => {
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.seg-btn')
    );
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('emits selectedKeyChange when a different segment is clicked', () => {
    const emitted: string[] = [];
    component.selectedKeyChange.subscribe((k) => emitted.push(k));
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.seg-btn')
    );
    buttons[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual(['7d']);
    expect(component.selectedKey).toBe('7d');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not re-emit when the already-selected segment is clicked', () => {
    const emitted: string[] = [];
    component.selectedKeyChange.subscribe((k) => emitted.push(k));
    (fixture.nativeElement.querySelector('.seg-btn') as HTMLButtonElement).click();
    expect(emitted).toEqual([]);
  });
});
