import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

interface TollTab {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-tolls-shell',
  templateUrl: './tolls-shell.component.html',
  styleUrls: ['./tolls-shell.component.css']
})
export class TollsShellComponent implements OnInit {
  tabs: TollTab[] = [
    { label: 'Overview', path: '/tolls', icon: 'speed' },
    { label: 'Transactions', path: '/tolls/transactions', icon: 'receipt_long' },
    { label: 'Import', path: '/tolls/import', icon: 'upload_file' },
    { label: 'History', path: '/tolls/history', icon: 'history' },
    { label: 'Accounts', path: '/tolls/accounts', icon: 'account_balance' },
    { label: 'Devices', path: '/tolls/devices', icon: 'sensors' },
    { label: 'Exceptions', path: '/tolls/exceptions', icon: 'warning' },
  ];

  activeTab = '/tolls';

  constructor(private router: Router) {}

  ngOnInit(): void {
    this.syncActiveTab(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event: any) => {
      this.syncActiveTab(event.urlAfterRedirects || event.url);
    });
  }

  navigate(path: string): void {
    this.router.navigate([path]);
  }

  private syncActiveTab(url: string): void {
    const found = this.tabs.slice().reverse().find((tab) => url.startsWith(tab.path));
    this.activeTab = found ? found.path : '/tolls';
  }
}
