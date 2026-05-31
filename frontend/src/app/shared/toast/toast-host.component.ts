import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Observable } from 'rxjs';
import { Toast, ToastService } from './toast.service';

/**
 * Fixed top-right stack that renders toasts from {@link ToastService}.
 * Mounted once at app root. Declared + exported from `SharedModule`.
 */
@Component({
  selector: 'app-toast-host',
  templateUrl: './toast-host.component.html',
  styleUrls: ['./toast-host.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  readonly toasts$: Observable<Toast[]> = this.toastService.toasts$;

  constructor(private readonly toastService: ToastService) {}

  trackById(_index: number, toast: Toast): number {
    return toast.id;
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
