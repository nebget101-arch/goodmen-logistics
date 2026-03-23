import { Component, forwardRef, HostBinding, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * AI-themed date field backed by Angular Material Datepicker.
 * Implements ControlValueAccessor — use with reactive forms or template-driven ngModel.
 *
 * Form model value: `YYYY-MM-DD` string or `null` (drop-in for native `<input type="date">`).
 */
@Component({
  selector: 'app-ai-date-picker',
  templateUrl: './ai-date-picker.component.html',
  styleUrls: ['./ai-date-picker.component.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AiDatePickerComponent),
      multi: true
    }
  ]
})
export class AiDatePickerComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() name = '';
  /** Optional id for the input (label association / tests). */
  @Input() inputId = '';
  @Input() touchUi = false;
  @Input() startView: 'month' | 'year' | 'multi-year' = 'month';
  @Input() min: Date | null = null;
  @Input() max: Date | null = null;
  /** Accessible name when no visible label. */
  @Input() ariaLabel = '';
  /** Compact layout for tables / filter toolbars. */
  @Input() inline = false;

  @HostBinding('class.ai-date-picker--inline')
  get inlineHostClass(): boolean {
    return this.inline;
  }

  private _disabled = false;

  @Input()
  set disabled(v: boolean) {
    this._disabled = !!v;
  }
  get disabled(): boolean {
    return this._disabled;
  }

  value: Date | null = null;

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(obj: unknown): void {
    this.value = this.parseToDate(obj);
  }

  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this._disabled = isDisabled;
  }

  onDateChange(d: Date | null): void {
    this.value = d;
    this.onChange(d ? this.toIsoLocal(d) : null);
  }

  onBlur(): void {
    this.onTouched();
  }

  private parseToDate(v: unknown): Date | null {
    if (v == null || v === '') {
      return null;
    }
    if (v instanceof Date) {
      return Number.isNaN(v.getTime()) ? null : v;
    }
    if (typeof v === 'string') {
      const s = v.trim().slice(0, 10);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) {
        return null;
      }
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      return new Date(y, mo, d);
    }
    return null;
  }

  private toIsoLocal(d: Date): string {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
}
