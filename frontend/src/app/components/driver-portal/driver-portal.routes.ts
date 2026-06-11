import { Routes } from '@angular/router';

export const DRIVER_PORTAL_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./shell/shell.component').then(m => m.DriverPortalShellComponent),
    children: [
      {
        path: '',
        redirectTo: 'incidents',
        pathMatch: 'full',
      },
      {
        path: 'incidents',
        loadComponent: () =>
          import('./incident-list/incident-list.component').then(
            m => m.IncidentListComponent
          ),
      },
    ],
  },
];
