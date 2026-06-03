import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { take } from 'rxjs/operators';
import { Toast, ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  function snapshot(): Toast[] {
    let current: Toast[] = [];
    service.toasts$.pipe(take(1)).subscribe((t) => (current = t));
    return current;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with an empty toast list', () => {
    expect(snapshot().length).toBe(0);
  });

  it('success/error/info push a typed toast', () => {
    service.success('saved');
    service.error('boom');
    service.info('heads up');
    const toasts = snapshot();
    expect(toasts.length).toBe(3);
    expect(toasts[0].type).toBe('success');
    expect(toasts[1].type).toBe('error');
    expect(toasts[2].type).toBe('info');
    expect(toasts[0].message).toBe('saved');
  });

  it('assigns incrementing ids', () => {
    const a = service.success('a');
    const b = service.success('b');
    expect(b).toBe(a + 1);
  });

  it('dismiss(id) removes a toast manually', fakeAsync(() => {
    const id = service.info('manual');
    expect(snapshot().length).toBe(1);
    service.dismiss(id);
    expect(snapshot().length).toBe(0);
    // flush the pending auto-dismiss timer so fakeAsync zone is clean
    tick(4000);
  }));

  it('auto-dismisses a toast after 4000ms', fakeAsync(() => {
    service.success('temporary');
    expect(snapshot().length).toBe(1);
    tick(3999);
    expect(snapshot().length).toBe(1);
    tick(1);
    expect(snapshot().length).toBe(0);
  }));
});
