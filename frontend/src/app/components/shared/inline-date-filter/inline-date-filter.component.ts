import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, Renderer2 } from '@angular/core';

@Component({
  selector: 'app-inline-date-filter',
  templateUrl: './inline-date-filter.component.html',
  styleUrls: ['./inline-date-filter.component.css']
})
export class InlineDateFilterComponent implements OnInit, OnDestroy {
  @Input() placeholder = 'Choose';
  @Input() value = ''; // expected format: YYYY-MM-DD or empty
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  baseYear = 0;
   view: 'year' | 'month' | 'day' = 'year';
   selectedYear: number | null = null;
   selectedMonth: number | null = null; // 0-based

  private documentClickUnlisten: (() => void) | null = null;

  constructor(private host: ElementRef, private renderer: Renderer2) {
    const now = new Date();
    const year = now.getFullYear();
    this.baseYear = year - (year % 10);
  }

  ngOnInit(): void {
    this.documentClickUnlisten = this.renderer.listen('document', 'click', (event: Event) => {
      if (!this.host.nativeElement.contains(event.target)) {
        this.open = false;
      }
    });
  }

  ngOnDestroy(): void {
    if (this.documentClickUnlisten) {
      this.documentClickUnlisten();
      this.documentClickUnlisten = null;
    }
  }

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.open) {
      this.syncFromValue();
      this.view = 'year';
    }
    this.open = !this.open;
  }

  get displayLabel(): string {
    if (!this.value) return this.placeholder;
    return this.value;
  }

  private syncFromValue(): void {
    if (!this.value || this.value.length < 4) {
      this.selectedYear = null;
      this.selectedMonth = null;
      return;
    }

    const year = Number(this.value.slice(0, 4));
    if (!isNaN(year)) {
      this.selectedYear = year;
      const decadeBase = year - (year % 10);
      this.baseYear = decadeBase;
    }

    if (this.value.length >= 7) {
      const month = Number(this.value.slice(5, 7));
      if (!isNaN(month) && month >= 1 && month <= 12) {
        this.selectedMonth = month - 1;
      }
    }
  }

  years(): number[] {
    return Array.from({ length: 10 }, (_, i) => this.baseYear + i);
  }

  prevRange(event: MouseEvent): void {
    event.stopPropagation();
    this.baseYear -= 10;
  }

  nextRange(event: MouseEvent): void {
    event.stopPropagation();
    this.baseYear += 10;
  }

  selectYear(year: number, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedYear = year;
    this.view = 'month';
  }

  months(): { index: number; label: string }[] {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return labels.map((label, index) => ({ index, label }));
  }

  selectMonth(monthIndex: number, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedMonth = monthIndex;
    this.view = 'day';
  }

  days(): number[] {
    if (this.selectedYear == null || this.selectedMonth == null) {
      return [];
    }
    const year = this.selectedYear;
    const month = this.selectedMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }

  selectDay(day: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.selectedYear == null || this.selectedMonth == null) return;

    const y = this.selectedYear;
    const m = this.selectedMonth + 1;
    const mm = m < 10 ? `0${m}` : `${m}`;
    const dd = day < 10 ? `0${day}` : `${day}`;

    this.value = `${y}-${mm}-${dd}`;
    this.valueChange.emit(this.value);
    this.open = false;
  }

  goUp(event: MouseEvent): void {
    event.stopPropagation();
    if (this.view === 'day') {
      this.view = 'month';
    } else if (this.view === 'month') {
      this.view = 'year';
    }
  }
}

