import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

interface FuelTab { label: string; path: string; icon: string; }

@Component({
  selector: 'app-fuel-shell',
  templateUrl: './fuel-shell.component.html',
  styleUrls: ['./fuel-shell.component.css']
})
export class FuelShellComponent implements OnInit {
  tabs: FuelTab[] = [
    { label: 'Overview',    path: '/fuel',             icon: 'speed' },
    { label: 'Transactions',path: '/fuel/transactions', icon: 'receipt_long' },
    { label: 'Import',      path: '/fuel/import',       icon: 'upload_file' },
    { label: 'History',     path: '/fuel/history',      icon: 'history' },
    { label: 'Fuel Cards',  path: '/fuel/cards',        icon: 'credit_card' },
    { label: 'Exceptions',  path: '/fuel/exceptions',   icon: 'warning' },
  ];

  activeTab = '/fuel';

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.syncActiveTab(this.router.url);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.syncActiveTab(e.urlAfterRedirects || e.url);
    });
  }

  private syncActiveTab(url: string): void {
    const match = this.tabs.slice().reverse().find(t => url.startsWith(t.path));
    this.activeTab = match ? match.path : '/fuel';
  }

  navigate(tab: FuelTab): void {
    this.router.navigate([tab.path]);
  }
}
