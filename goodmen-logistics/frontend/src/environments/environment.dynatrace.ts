/**
 * Dynatrace RUM (Real User Monitoring) Configuration for Angular
 * Add this to your index.html <head> section
 */

export const environment = {
  production: true,
  dynatrace: {
    enabled: true,
    // Get these from Dynatrace: Settings > Web and mobile monitoring > Applications
    applicationId: 'YOUR_APPLICATION_ID', // e.g., APPLICATION-1234567890ABCDEF
    beaconUrl: 'https://muz70888.live.dynatrace.com/mbeacon', // Your environment's beacon URL
    
    // Optional: Configure what to monitor
    config: {
      // Automatically detect JavaScript errors
      enableJavaScriptErrors: true,
      
      // Track user interactions (clicks, form submissions)
      enableUserActions: true,
      
      // Monitor XHR/Fetch requests to your API
      enableXhrMonitoring: true,
      
      // Track page load performance
      enablePageLoadMonitoring: true,
      
      // Session replay (optional - requires license)
      enableSessionReplay: false,
      
      // Custom properties
      metadata: {
        team: 'logistics',
        application: 'SafetyApp'
      }
    }
  }
};
