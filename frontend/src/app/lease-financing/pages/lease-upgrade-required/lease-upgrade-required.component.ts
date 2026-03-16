import { Component } from '@angular/core';

@Component({
  selector: 'app-lease-upgrade-required',
  template: `
    <section class="upgrade card">
      <h2>Upgrade Required</h2>
      <p>
        Lease-to-Own Financing and Fleet Financing Dashboard are available on
        <strong>Advanced</strong> and <strong>Enterprise</strong> plans.
      </p>
      <a routerLink="/dashboard" class="btn">Back to Dashboard</a>
    </section>
  `,
  styles: [`.card{padding:1rem;border:1px solid #dbe4f4;border-radius:12px;background:#fff}.btn{display:inline-block;margin-top:.75rem;padding:.5rem .8rem;border-radius:8px;background:#1f57c3;color:#fff;text-decoration:none}`]
})
export class LeaseUpgradeRequiredComponent {}
