/**
 * Dynatrace RUM (Real User Monitoring) Configuration
 * This configuration is used to inject Dynatrace JavaScript for Angular frontend monitoring
 */

export interface DynatraceConfig {
  enabled: boolean;
  environmentId: string;
  applicationId: string;
  beaconUrl: string;
  scriptUrl: string;
}

export const dynatraceConfig: DynatraceConfig = {
  // Enable/disable Dynatrace RUM
  // Disabled for now - focus on backend monitoring first
  enabled: false,
  
  // Your Dynatrace Environment ID (8-character ID from your tenant URL)
  // Example: if your URL is https://abc12345.live.dynatrace.com, the ID is 'abc12345'
  environmentId: 'muz70888',
  
  // Your Application ID from Dynatrace (found in Settings > Web and mobile monitoring > Applications)
  // We'll add this later when we set up frontend monitoring
  applicationId: 'YOUR_APPLICATION_ID',
  
  // Beacon URL (usually auto-configured, but can be customized)
  beaconUrl: '', // Leave empty for auto-configuration
  
  // Script URL (injected into the page)
  scriptUrl: '' // Leave empty for auto-configuration
};

/**
 * Get the Dynatrace RUM script URL
 */
export function getDynatraceScriptUrl(): string {
  if (!dynatraceConfig.enabled) {
    return '';
  }
  
  if (dynatraceConfig.scriptUrl) {
    return dynatraceConfig.scriptUrl;
  }
  
  // Auto-generate script URL based on environment ID
  return `https://${dynatraceConfig.environmentId}.live.dynatrace.com/jstag/${dynatraceConfig.applicationId}/dt_rum_config.js`;
}

/**
 * Initialize Dynatrace RUM programmatically
 */
export function initializeDynatraceRUM(): void {
  if (!dynatraceConfig.enabled) {
    console.log('Dynatrace RUM is disabled');
    return;
  }

  if (!dynatraceConfig.environmentId || !dynatraceConfig.applicationId) {
    console.warn('Dynatrace credentials not configured. Skipping RUM initialization.');
    return;
  }

  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = getDynatraceScriptUrl();
  
  script.onload = () => {
    console.log('✅ Dynatrace RUM initialized successfully');
  };
  
  script.onerror = () => {
    console.error('❌ Failed to load Dynatrace RUM script');
  };
  
  document.head.appendChild(script);
}

/**
 * Send custom user action to Dynatrace
 */
export function trackUserAction(actionName: string, metadata?: Record<string, any>): void {
  if (!dynatraceConfig.enabled) return;
  
  try {
    // Access Dynatrace API if available
    if ((window as any).dtrum) {
      (window as any).dtrum.actionName(actionName);
      
      if (metadata) {
        Object.entries(metadata).forEach(([key, value]) => {
          (window as any).dtrum.sendSessionProperties(key, value);
        });
      }
    }
  } catch (error) {
    console.error('Error tracking user action:', error);
  }
}

/**
 * Report custom error to Dynatrace
 */
export function reportError(error: Error, context?: Record<string, any>): void {
  if (!dynatraceConfig.enabled) return;
  
  try {
    if ((window as any).dtrum) {
      (window as any).dtrum.reportError(error);
      
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          (window as any).dtrum.sendSessionProperties(key, value);
        });
      }
    }
  } catch (err) {
    console.error('Error reporting to Dynatrace:', err);
  }
}

/**
 * Set user identification
 */
export function identifyUser(userId: string, userEmail?: string, userName?: string): void {
  if (!dynatraceConfig.enabled) return;
  
  try {
    if ((window as any).dtrum) {
      (window as any).dtrum.identifyUser(userId);
      
      if (userEmail) {
        (window as any).dtrum.sendSessionProperties('userEmail', userEmail);
      }
      
      if (userName) {
        (window as any).dtrum.sendSessionProperties('userName', userName);
      }
    }
  } catch (error) {
    console.error('Error identifying user:', error);
  }
}
