/// <reference types="jasmine" />

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AiSkeletonComponent } from './ai-skeleton.component';

describe('AiSkeletonComponent.toCssLength (FN-1636)', () => {
  it('converts numbers to px', () => {
    expect(AiSkeletonComponent.toCssLength(40)).toBe('40px');
  });

  it('converts numeric strings to px', () => {
    expect(AiSkeletonComponent.toCssLength('24')).toBe('24px');
  });

  it('passes through explicit CSS lengths', () => {
    expect(AiSkeletonComponent.toCssLength('100%')).toBe('100%');
    expect(AiSkeletonComponent.toCssLength('1.5rem')).toBe('1.5rem');
  });
});

describe('AiSkeletonComponent (DOM)', () => {
  let fixture: ComponentFixture<AiSkeletonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AiSkeletonComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(AiSkeletonComponent);
    fixture.detectChanges();
  });

  it('announces aria-busy="true" and aria-label="Loading" on the host', () => {
    const host: HTMLElement = fixture.nativeElement;
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.getAttribute('aria-label')).toBe('Loading');
    expect(host.getAttribute('role')).toBe('status');
  });

  it('applies width/height/radius styles to the bar', () => {
    fixture.componentInstance.width = 120;
    fixture.componentInstance.height = '2rem';
    fixture.componentInstance.radius = 4;
    fixture.detectChanges();
    const bar = fixture.nativeElement.querySelector('.skeleton-bar') as HTMLElement;
    expect(bar.style.width).toBe('120px');
    expect(bar.style.height).toBe('2rem');
    expect(bar.style.borderRadius).toBe('4px');
  });
});
