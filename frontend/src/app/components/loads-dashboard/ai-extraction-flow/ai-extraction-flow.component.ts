import {
  Component, Input, Output, EventEmitter,
  ChangeDetectionStrategy, ChangeDetectorRef
} from '@angular/core';
import { Router } from '@angular/router';
import { LoadsService } from '../../../services/loads.service';

export interface ExtractionStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export interface ExtractionResult {
  data: any;
  confidenceMap: Record<string, number>;
  confidenceTiers: Record<string, string>;
  overallConfidence: number;
  extractionMethod: string;
  isVision: boolean;
  aiPrefilledFields: Set<string>;
}

@Component({
  selector: 'app-ai-extraction-flow',
  templateUrl: './ai-extraction-flow.component.html',
  styleUrls: ['./ai-extraction-flow.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiExtractionFlowComponent {
  @Input() file: File | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() extracted = new EventEmitter<ExtractionResult>();

  steps: ExtractionStep[] = [
    { label: 'Extracting text from PDF', status: 'pending' },
    { label: 'Identifying broker & references', status: 'pending' },
    { label: 'Parsing stops & addresses', status: 'pending' },
    { label: 'Calculating rate & confidence', status: 'pending' }
  ];

  currentStep = -1;
  error = '';
  isVisionWarning = false;
  extractionComplete = false;
  result: any = null;

  constructor(
    private loadsService: LoadsService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  startExtraction(): void {
    if (!this.file) return;
    this.error = '';
    this.extractionComplete = false;
    this.isVisionWarning = false;
    this.result = null;

    // Simulate progressive steps (the API call is a single request,
    // but we animate through steps for UX)
    this.advanceStep(0);
    const stepInterval = setInterval(() => {
      if (this.currentStep < 2) {
        this.advanceStep(this.currentStep + 1);
      }
    }, 800);

    this.loadsService.aiExtractFromPdf(this.file).subscribe({
      next: (res: any) => {
        clearInterval(stepInterval);
        // Mark all steps done
        this.steps.forEach(s => s.status = 'done');
        this.currentStep = 3;
        this.advanceStep(3);
        this.steps[3].status = 'done';

        const data = res?.data || res;
        const confidence = data?.confidence || {};
        const tiers = data?.confidence_tiers || {};
        const overall = data?.overall_confidence ?? 0;
        const method = data?.extraction_method || 'text';

        this.isVisionWarning = method === 'vision';
        this.extractionComplete = true;
        this.result = data;

        // Build the set of AI-prefilled fields (any field with value != null)
        const aiFields = new Set<string>();
        if (data.brokerName) aiFields.add('broker');
        if (data.poNumber) aiFields.add('poNumber');
        if (data.rate) aiFields.add('rate');
        if (data.loadId || data.orderId) aiFields.add('loadNumber');
        if (data.stops?.length) aiFields.add('stops');
        if (data.commodity) aiFields.add('commodity');

        this.cdr.markForCheck();

        // Emit after a short delay so user sees the completed state
        setTimeout(() => {
          this.extracted.emit({
            data,
            confidenceMap: confidence,
            confidenceTiers: tiers,
            overallConfidence: overall,
            extractionMethod: method,
            isVision: this.isVisionWarning,
            aiPrefilledFields: aiFields
          });
        }, 600);
      },
      error: (err: any) => {
        clearInterval(stepInterval);
        const failIdx = Math.max(this.currentStep, 0);
        this.steps[failIdx].status = 'error';
        this.error = err?.error?.warning || err?.error?.message || err?.message || 'Extraction failed. Please try again.';
        this.cdr.markForCheck();
      }
    });
  }

  retry(): void {
    this.steps.forEach(s => s.status = 'pending');
    this.currentStep = -1;
    this.error = '';
    this.cdr.markForCheck();
    this.startExtraction();
  }

  onClose(): void {
    this.close.emit();
  }

  getConfidenceClass(field: string): string {
    if (!this.result?.confidence_tiers) return '';
    const tier = this.result.confidence_tiers[field];
    if (tier === 'red') return 'confidence-low';
    if (tier === 'yellow') return 'confidence-medium';
    return 'confidence-high';
  }

  private advanceStep(idx: number): void {
    if (idx > 0 && this.steps[idx - 1].status === 'active') {
      this.steps[idx - 1].status = 'done';
    }
    if (idx < this.steps.length) {
      this.steps[idx].status = 'active';
      this.currentStep = idx;
    }
    this.cdr.markForCheck();
  }
}
