import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

interface SafetyTab { label: string; path: string; icon: string; }

@Component({
  selector: 'app-safety-shell',
  templateUrl: './safety-shell.component.html',
  styleUrls: ['./safety-shell.component.css']
})
export class SafetyShellComponent implements OnInit {
  tabs: SafetyTab[] = [
    { label: 'Overview',            path: '/safety',              icon: 'dashboard' },
    { label: 'Accidents',           path: '/safety/accidents',    icon: 'car_crash' },
    { label: 'Claims',              path: '/safety/claims',       icon: 'description' },
    { label: 'Tasks',               path: '/safety/tasks',        icon: 'checklist' },
    { label: 'Reports',             path: '/safety/reports',      icon: 'analytics' },
  ];

  activeTab = '/safety';

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.syncActiveTab(this.router.url);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.syncActiveTab(e.urlAfterRedirects || e.url);
    });
  }

  private syncActiveTab(url: string): void {
    const base = url.split('?')[0];
    const match = this.tabs.slice().reverse().find(t => base.startsWith(t.path));
    this.activeTab = match ? match.path : '/safety';
  }

  navigate(tab: SafetyTab): void {
    this.router.navigate([tab.path]);
  }
}
