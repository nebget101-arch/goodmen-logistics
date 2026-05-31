import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

/** Auto-dismiss delay for toasts, in milliseconds. */
const AUTO_DISMISS_MS = 4000;

/**
 * App-wide toast notifications. Rendered by `<app-toast-host>`. Toasts auto-
 * dismiss after 4s; `dismiss(id)` removes one manually.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private readonly toastsSubject = new BehaviorSubject<Toast[]>([]);

  readonly toasts$: Observable<Toast[]> = this.toastsSubject.asObservable();

  success(message: string): number {
    return this.push('success', message);
  }

  error(message: string): number {
    return this.push('error', message);
  }

  info(message: string): number {
    return this.push('info', message);
  }

  dismiss(id: number): void {
    this.toastsSubject.next(
      this.toastsSubject.value.filter((toast) => toast.id !== id)
    );
  }

  private push(type: ToastType, message: string): number {
    const id = this.nextId;
    this.nextId += 1;
    this.toastsSubject.next([
      ...this.toastsSubject.value,
      { id, type, message },
    ]);
    setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
    return id;
  }
}
