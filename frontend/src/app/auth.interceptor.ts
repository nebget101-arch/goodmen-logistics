import { Injectable } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';
import { OperatingEntityContextService } from './services/operating-entity-context.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private operatingEntityContext: OperatingEntityContextService) {}

  private isBackendApiRequest(url: string): boolean {
    if (!url) return false;
    if (url.startsWith('/api')) return true;
    return url.startsWith(environment.apiUrl);
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Keep app backward-compatible before selector initialization:
    // only send x-operating-entity-id when a selection exists.
    if (this.isBackendApiRequest(req.url)) {
      const operatingEntityId = this.operatingEntityContext.getSelectedOperatingEntityId();
      if (operatingEntityId) {
        headers['x-operating-entity-id'] = operatingEntityId;
      }
    }

    const nextReq = Object.keys(headers).length === 0 ? req : req.clone({ setHeaders: headers });

    return next.handle(nextReq).pipe(
      catchError((error: HttpErrorResponse) => {
        if (this.isBackendApiRequest(req.url) && error?.status === 403) {
          const message = `${error?.error?.error || ''} ${error?.error?.message || ''}`.toLowerCase();
          if (message.includes('operating entity')) {
            this.operatingEntityContext.recoverFromStaleSelection();
          }
        }
        return throwError(() => error);
      })
    );

  }
}
