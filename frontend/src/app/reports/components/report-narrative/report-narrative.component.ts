import { Component, Input } from '@angular/core';
import { ReportNarrative } from '../../reports.models';

@Component({
  selector: 'app-report-narrative',
  templateUrl: './report-narrative.component.html',
  styleUrls: ['./report-narrative.component.css']
})
export class ReportNarrativeComponent {
  @Input() narrative: ReportNarrative | null = null;
  @Input() loading = false;
  @Input() failed = false;

  get visible(): boolean {
    if (this.failed) return false;
    return this.loading || !!this.narrative?.narrative;
  }

  get generatedAtLabel(): string | null {
    const iso = this.narrative?.generatedAt;
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
}
