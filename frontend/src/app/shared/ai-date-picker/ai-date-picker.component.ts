import { Component, forwardRef, Input } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * AI-themed date field backed by Angular Material Datepicker.
 * Implements ControlValueAccessor — use with reactive forms or template-driven ngModel.
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

  private _disabled = false;

  @Input()
  set disabled(v: boolean) {
    this._disabled = !!v;
  }
  get disabled(): boolean {
    return this._disabled;
  }

  value: Date | null = null;

  private onChange: (v: Date | null) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(obj: Date | null): void {
    this.value = obj ?? null;
  }

  registerOnChange(fn: (v: Date | null) => void): void {
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
    this.onChange(d);
  }

  onBlur(): void {
    this.onTouched();
  }
}
