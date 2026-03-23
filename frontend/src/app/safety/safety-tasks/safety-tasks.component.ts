import { Component, OnInit } from '@angular/core';
import { SafetyService } from '../safety.service';

@Component({
  selector: 'app-safety-tasks',
  templateUrl: './safety-tasks.component.html',
  styleUrls: ['./safety-tasks.component.css']
})
export class SafetyTasksComponent implements OnInit {
  tasks: any[] = [];
  loading = true;
  error = '';

  filters: any = {
    overdue_only: true,
    status: '',
    assigned_to: ''
  };
  readonly statusSelectOptions = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'overdue', label: 'Overdue' }
  ];

  constructor(private safety: SafetyService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.safety.getAllTasks({
      overdue_only: this.filters.overdue_only || undefined,
      status: this.filters.status || undefined,
      assigned_to: this.filters.assigned_to || undefined,
    }).subscribe({
      next: (rows) => { this.tasks = rows || []; this.loading = false; },
      error: () => { this.error = 'Failed to load tasks'; this.loading = false; }
    });
  }

  clearFilters(): void {
    this.filters = { overdue_only: true, status: '', assigned_to: '' };
    this.load();
  }

  markCompleted(task: any): void {
    if (!task?.incident_id || !task?.id) return;
    this.safety.updateTask(task.incident_id, task.id, { status: 'completed' }).subscribe({
      next: (updated) => {
        const idx = this.tasks.findIndex(t => t.id === task.id);
        if (idx > -1) this.tasks[idx] = { ...this.tasks[idx], ...updated };
      },
      error: () => alert('Failed to complete task')
    });
  }

  statusClass(s: string): string {
    if (s === 'completed') return 'task-completed';
    if (s === 'overdue') return 'task-overdue';
    if (s === 'in_progress') return 'task-progress';
    return 'task-open';
  }

  dueClass(task: any): string {
    if (!task?.due_date || task?.status === 'completed') return '';
    const due = new Date(task.due_date).getTime();
    return due < Date.now() ? 'due-overdue' : '';
  }
}
