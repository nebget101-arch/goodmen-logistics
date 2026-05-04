/// <reference types="jasmine" />

import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Subject, of, throwError } from 'rxjs';

import { ReportChatDrawerComponent } from './report-chat-drawer.component';
import { ReportsService } from '../../services/reports.service';
import { ReportChatResponse } from '../../reports.models';

describe('ReportChatDrawerComponent (FN-1136)', () => {
  let fixture: ComponentFixture<ReportChatDrawerComponent>;
  let component: ReportChatDrawerComponent;
  let reportsService: jasmine.SpyObj<ReportsService>;

  beforeEach(async () => {
    reportsService = jasmine.createSpyObj<ReportsService>('ReportsService', ['chatWithReport']);

    await TestBed.configureTestingModule({
      declarations: [ReportChatDrawerComponent],
      imports: [FormsModule],
      providers: [{ provide: ReportsService, useValue: reportsService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportChatDrawerComponent);
    component = fixture.componentInstance;
    component.reportKey = 'direct-load-profit';
    component.reportTitle = 'Direct Load Profit';
    component.filters = { startDate: '2026-01-01' };
    component.data = [{ load: 'L1', profit: 100 }];
    fixture.detectChanges();
  });

  it('does not render the drawer panel when [open] is false', () => {
    component.open = false;
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.chat-drawer');
    expect(panel).toBeNull();
  });

  it('renders the drawer when [open] becomes true', () => {
    component.open = true;
    component.ngOnChanges({
      open: { previousValue: false, currentValue: true, firstChange: false, isFirstChange: () => false } as any,
    });
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.chat-drawer');
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });

  it('emits closed when Escape is pressed while open', () => {
    component.open = true;
    fixture.detectChanges();
    spyOn(component.closed, 'emit');
    component.onDocumentKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.closed.emit).toHaveBeenCalled();
  });

  it('emits closed when overlay is clicked', () => {
    component.open = true;
    fixture.detectChanges();
    spyOn(component.closed, 'emit');
    component.onOverlayClick();
    expect(component.closed.emit).toHaveBeenCalled();
  });

  it('appends user message immediately and assistant reply on success', fakeAsync(() => {
    const reply: ReportChatResponse = { reply: 'Dispatcher X had the lowest margin.' };
    reportsService.chatWithReport.and.returnValue(of(reply));
    component.open = true;
    component.inputValue = 'Which dispatcher had the lowest margin?';
    fixture.detectChanges();

    component.send();
    tick();

    expect(component.messages.length).toBe(2);
    expect(component.messages[0].role).toBe('user');
    expect(component.messages[0].content).toBe('Which dispatcher had the lowest margin?');
    expect(component.messages[1].role).toBe('assistant');
    expect(component.messages[1].content).toBe('Dispatcher X had the lowest margin.');
    expect(component.isSending).toBeFalse();
    expect(component.inputValue).toBe('');
  }));

  it('sends prior history (excluding the current user message) to the chat endpoint', fakeAsync(() => {
    reportsService.chatWithReport.and.returnValue(of({ reply: 'first response' }));
    component.open = true;
    component.inputValue = 'first?';
    component.send();
    tick();
    expect(component.messages.length).toBe(2);

    reportsService.chatWithReport.and.returnValue(of({ reply: 'second response' }));
    component.inputValue = 'second?';
    component.send();
    tick();

    const secondCall = reportsService.chatWithReport.calls.mostRecent().args[0];
    expect(secondCall.history.length).toBe(2);
    expect(secondCall.history[0].role).toBe('user');
    expect(secondCall.history[0].content).toBe('first?');
    expect(secondCall.history[1].role).toBe('assistant');
    expect(secondCall.history[1].content).toBe('first response');
    expect(secondCall.message).toBe('second?');
  }));

  it('shows an error and keeps the user message when the chat call fails', fakeAsync(() => {
    reportsService.chatWithReport.and.returnValue(throwError(() => ({ error: { error: 'rate-limited' } })));
    component.open = true;
    component.inputValue = 'why';
    component.send();
    tick();

    expect(component.error).toBe('rate-limited');
    expect(component.isSending).toBeFalse();
    expect(component.messages.length).toBe(1);
    expect(component.messages[0].role).toBe('user');
  }));

  it('does not send when input is empty or while a request is in flight', () => {
    component.open = true;
    component.inputValue = '   ';
    component.send();
    expect(reportsService.chatWithReport).not.toHaveBeenCalled();

    const pending$ = new Subject<ReportChatResponse>();
    reportsService.chatWithReport.and.returnValue(pending$.asObservable());
    component.inputValue = 'hello';
    component.send();
    expect(reportsService.chatWithReport).toHaveBeenCalledTimes(1);

    component.inputValue = 'still hello';
    component.send();
    expect(reportsService.chatWithReport).toHaveBeenCalledTimes(1);
  });

  it('truncates outgoing data to the first 100 rows', fakeAsync(() => {
    const big: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 250; i++) big.push({ idx: i });
    component.data = big;
    reportsService.chatWithReport.and.returnValue(of({ reply: 'ok' }));
    component.open = true;
    component.inputValue = 'go';
    component.send();
    tick();

    const sent = reportsService.chatWithReport.calls.mostRecent().args[0];
    expect(sent.data.length).toBe(100);
    expect(sent.data[0]).toEqual({ idx: 0 });
    expect(sent.data[99]).toEqual({ idx: 99 });
  }));

  it('clears the conversation when reportKey changes', fakeAsync(() => {
    reportsService.chatWithReport.and.returnValue(of({ reply: 'hello' }));
    component.open = true;
    component.inputValue = 'hi';
    component.send();
    tick();
    expect(component.messages.length).toBe(2);

    component.ngOnChanges({
      reportKey: { previousValue: 'direct-load-profit', currentValue: 'gross-profit', firstChange: false, isFirstChange: () => false } as any,
    });

    expect(component.messages).toEqual([]);
    expect(component.inputValue).toBe('');
    expect(component.error).toBe('');
  }));

  it('traps Tab focus inside the drawer', () => {
    component.open = true;
    fixture.detectChanges();

    const root = fixture.nativeElement.querySelector('.chat-drawer') as HTMLElement;
    expect(root).not.toBeNull();
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    ));
    expect(focusables.length).toBeGreaterThan(0);

    const last = focusables[focusables.length - 1];
    last.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    spyOn(event, 'preventDefault');
    component.onDocumentKeydown(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
