import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <div class="app">
      <header class="header">
        <div class="header-content">
          <div class="logo">
            <span class="logo-icon">🚛</span>
            <div>
              <h1>Goodmen Logistics</h1>
              <small style="opacity: 0.9;">FMCSA Compliance & Operations</small>
            </div>
          </div>
          <nav>
            <ul class="nav-links">
              <li><a routerLink="/dashboard" routerLinkActive="active">Dashboard</a></li>
              <li><a routerLink="/drivers" routerLinkActive="active">Drivers</a></li>
              <li><a routerLink="/vehicles" routerLinkActive="active">Vehicles</a></li>
              <li><a routerLink="/hos" routerLinkActive="active">HOS</a></li>
              <li><a routerLink="/maintenance" routerLinkActive="active">Maintenance</a></li>
              <li><a routerLink="/loads" routerLinkActive="active">Loads</a></li>
              <li><a routerLink="/audit" routerLinkActive="active">Audit</a></li>
            </ul>
          </nav>
        </div>
      </header>
      <main>
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .app {
      min-height: 100vh;
    }
    main {
      padding: 20px;
    }
    .active {
      border-bottom: 2px solid white;
    }
  `]
})
export class AppComponent {
  title = 'Goodmen Logistics';
}
