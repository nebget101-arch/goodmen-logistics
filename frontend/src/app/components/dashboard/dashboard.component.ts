import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { OperatingEntityContextService } from '../../services/operating-entity-context.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  stats: any = {};
  loading = true;
  isDegraded = false;
  degradedGroups: string[] = [];
  activeOperatingEntityName = '';

  private destroy$ = new Subject<void>();
  private lastOperatingEntityId: string | null | undefined = undefined;

  constructor(
    private apiService: ApiService,
    private operatingEntityContext: OperatingEntityContextService
  ) { }

  ngOnInit(): void {
    this.bindOperatingEntityContext();
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindOperatingEntityContext(): void {
    this.operatingEntityContext.context$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!state.isLoaded) return;

        this.activeOperatingEntityName = state.selectedOperatingEntity?.name || '';
        const nextId = state.selectedOperatingEntityId || null;

        if (this.lastOperatingEntityId === undefined) {
          this.lastOperatingEntityId = nextId;
          return;
        }

        if (this.lastOperatingEntityId !== nextId) {
          this.lastOperatingEntityId = nextId;
          this.loadDashboard();
        }
      });
  }

  loadDashboard(): void {
    this.apiService.getDashboardStats().subscribe({
      next: (data) => {
        this.stats = data;
        this.isDegraded = !!data?.degraded;
        this.degradedGroups = Array.isArray(data?.degradedGroups) ? data.degradedGroups : [];
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading dashboard stats:', error);
        this.loading = false;
      }
    });
  }
}
