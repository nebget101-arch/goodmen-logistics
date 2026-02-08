import { Injectable, ErrorHandler } from '@angular/core';
import { reportError } from '../dynatrace-config';

/**
 * Global Error Handler with Dynatrace Integration
 * Captures all unhandled errors and reports them to Dynatrace
 */
@Injectable()
export class DynatraceErrorHandler implements ErrorHandler {
  handleError(error: Error): void {
    // Log to console for development
    console.error('Global error caught:', error);
    
    // Report to Dynatrace
    reportError(error, {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    });
    
    // Re-throw to maintain default Angular error handling
    throw error;
  }
}
