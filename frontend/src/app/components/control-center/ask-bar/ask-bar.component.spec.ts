/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';

import { AskBarComponent } from './ask-bar.component';
import { AskService, AskSuccessResponse } from '../../../services/ask.service';

const mockResponse: AskSuccessResponse = {
  success: true,
  intent: 'loads',
  answer: {
    kind: 'text',
    headline: '3 loads at risk today',
    detail: 'L-1101 and L-1108 are running tight on appointment windows; L-1207 is awaiting a re-broker.',
  },
  classification: { confidence: 0.91, reasoning: 'mentions loads', source: 'claude' },
  meta: { model: 'claude-sonnet-4-6', processingTimeMs: 412 },
};

describe('AskBarComponent', () => {
  let fixture: ComponentFixture<AskBarComponent>;
  let component: AskBarComponent;
  let askService: jasmine.SpyObj<AskService>;

  beforeEach(async () => {
    askService = jasmine.createSpyObj<AskService>('AskService', ['ask']);
    askService.ask.and.returnValue(of(mockResponse));

    await TestBed.configureTestingModule({
      imports: [AskBarComponent],
      providers: [{ provide: AskService, useValue: askService }],
    }).compileComponents();

    fixture = TestBed.createComponent(AskBarComponent);
    component = fixture.componentInstance;
  });

  it('exposes accessible labels: region heading, input label, aria-live region', () => {
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-labelledby')).toBe('ask-bar-heading');
    expect(fixture.nativeElement.querySelector('#ask-bar-heading')).toBeTruthy();

    const input = fixture.nativeElement.querySelector('.ask-bar__input');
    expect(input.getAttribute('aria-label')).toContain('Ask FleetNeuron');

    const live = fixture.nativeElement.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
  });

  it('does not call AskService when prompt is empty or whitespace', () => {
    fixture.detectChanges();
    component.prompt = '   ';
    component.submit();
    expect(askService.ask).not.toHaveBeenCalled();
  });

  it('calls AskService.ask with the trimmed prompt + briefingContext and renders the answer', fakeAsync(() => {
    fixture.detectChanges();

    component.prompt = '  loads at risk?  ';
    component.submit();
    tick();
    fixture.detectChanges();

    expect(askService.ask).toHaveBeenCalledTimes(1);
    const arg = askService.ask.calls.argsFor(0)[0];
    expect(arg.prompt).toBe('loads at risk?');
    // briefingContext is null until wired to BriefingService — verify the field name still goes through.
    expect('briefingContext' in arg).toBe(true);

    expect(component.loading).toBe(false);
    expect(component.response).toEqual(mockResponse);

    const card = fixture.nativeElement.querySelector('.ask-bar__card');
    expect(card).toBeTruthy();
    expect(card.getAttribute('data-kind')).toBe('text');
    expect(card.querySelector('.ask-bar__card-headline').textContent).toContain('3 loads at risk today');
    expect(card.querySelector('.ask-bar__card-text').textContent).toContain('L-1101');

    const intent = fixture.nativeElement.querySelector('.ask-bar__intent-pill');
    expect(intent.getAttribute('data-intent')).toBe('loads');
  }));

  it('shows the skeleton while a request is in flight', () => {
    const pending = new Subject<AskSuccessResponse>();
    askService.ask.and.returnValue(pending.asObservable());

    fixture.detectChanges();
    component.prompt = 'something';
    component.submit();
    fixture.detectChanges();

    expect(component.loading).toBe(true);
    expect(fixture.nativeElement.querySelector('.ask-bar__skeleton')).toBeTruthy();
    const region = fixture.nativeElement.querySelector('[role="region"]');
    expect(region.getAttribute('aria-busy')).toBe('true');

    pending.next(mockResponse);
    pending.complete();
  });

  it('renders an error fallback with a retry button when the request fails', () => {
    askService.ask.and.returnValue(throwError(() => new Error('502')));
    fixture.detectChanges();

    component.prompt = 'hello';
    component.submit();
    fixture.detectChanges();

    expect(component.loading).toBe(false);
    expect(component.errorMessage).toBeTruthy();

    const errorEl = fixture.nativeElement.querySelector('.ask-bar__error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.getAttribute('role')).toBe('alert');
    expect(errorEl.querySelector('.ask-bar__error-retry')).toBeTruthy();
  });

  it('surfaces the gateway error message verbatim when present', () => {
    const httpError = new HttpErrorResponse({
      error: { error: 'prompt is required' },
      status: 400,
      statusText: 'Bad Request',
    });
    askService.ask.and.returnValue(throwError(() => httpError));
    fixture.detectChanges();

    component.prompt = ' ignored '; // trimmed empty would skip; provide non-empty to actually submit
    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage).toBe('prompt is required');
  });

  it('retry() re-submits the last prompt', fakeAsync(() => {
    askService.ask.and.returnValue(throwError(() => new Error('502')));
    fixture.detectChanges();

    component.prompt = 'first prompt';
    component.submit();
    fixture.detectChanges();
    expect(component.errorMessage).toBeTruthy();

    askService.ask.and.returnValue(of(mockResponse));
    component.retry();
    tick();
    fixture.detectChanges();

    expect(askService.ask).toHaveBeenCalledTimes(2);
    expect(askService.ask.calls.argsFor(1)[0].prompt).toBe('first prompt');
    expect(component.response).toEqual(mockResponse);
  }));

  it('ESC closes results and clears errors', fakeAsync(() => {
    fixture.detectChanges();
    component.prompt = 'q';
    component.submit();
    tick();
    fixture.detectChanges();
    expect(component.response).toBeTruthy();

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    component.handleGlobalKeydown(event);
    fixture.detectChanges();

    expect(component.response).toBeNull();
    expect(component.errorMessage).toBeNull();
    expect(fixture.nativeElement.querySelector('.ask-bar__results')).toBeNull();
  }));

  it('focuses the input when "/" is pressed outside a text field', () => {
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.ask-bar__input') as HTMLInputElement;

    input.blur();
    document.body.focus();

    const event = new KeyboardEvent('keydown', { key: '/', cancelable: true });
    Object.defineProperty(event, 'target', { value: document.body });
    component.handleGlobalKeydown(event);

    expect(document.activeElement).toBe(input);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not hijack "/" when typing in another input', () => {
    fixture.detectChanges();
    const otherInput = document.createElement('input');
    document.body.appendChild(otherInput);
    otherInput.focus();

    const event = new KeyboardEvent('keydown', { key: '/', cancelable: true });
    Object.defineProperty(event, 'target', { value: otherInput });
    component.handleGlobalKeydown(event);

    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(otherInput);
  });

  it('announces the answer headline via the aria-live region', fakeAsync(() => {
    fixture.detectChanges();
    component.prompt = 'test';
    component.submit();
    tick();
    fixture.detectChanges();

    const live = fixture.nativeElement.querySelector('[aria-live="polite"]');
    expect(live.textContent).toContain('3 loads at risk today');
  }));
});
