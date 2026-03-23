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
  view: 'year' | 'month' | 'day' = 'day';
  selectedYear: number | null = null;
  selectedMonth: number | null = null; // 0-based
  selectedDay: number | null = null;

  // Controls which month/year is displayed in the calendar
  displayYear = new Date().getFullYear();
  displayMonth = new Date().getMonth(); // 0-based

  baseYear = 0;

  private documentClickUnlisten: (() => void) | null = null;

  constructor(private host: ElementRef, private renderer: Renderer2) {
    const now = new Date();
    this.baseYear = now.getFullYear() - (now.getFullYear() % 10);
  }

  ngOnInit(): void {
    this.documentClickUnlisten = this.renderer.listen('document', 'click', (event: Event) => {
      if (!this.host.nativeElement.contains(event.target)) {
        this.open = false;
      }
    });
    this.syncFromValue();
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
      this.view = 'day';
    }
    this.open = !this.open;
  }

  get displayLabel(): string {
    if (!this.value) return this.placeholder;
    // Format YYYY-MM-DD → MMM D, YYYY
    try {
      const [y, m, d] = this.value.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return this.value;
    }
  }

  get displayMonthLabel(): string {
    return new Date(this.displayYear, this.displayMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  private syncFromValue(): void {
    if (!this.value || this.value.length < 4) {
      // Default to current month
      const now = new Date();
      this.displayYear = now.getFullYear();
      this.displayMonth = now.getMonth();
      this.selectedYear = null;
      this.selectedMonth = null;
      this.selectedDay = null;
      return;
    }

    const year = Number(this.value.slice(0, 4));
    if (!isNaN(year)) {
      this.selectedYear = year;
      this.displayYear = year;
      this.baseYear = year - (year % 10);
    }

    if (this.value.length >= 7) {
      const month = Number(this.value.slice(5, 7));
      if (!isNaN(month) && month >= 1 && month <= 12) {
        this.selectedMonth = month - 1;
        this.displayMonth = month - 1;
      }
    }

    if (this.value.length >= 10) {
      const day = Number(this.value.slice(8, 10));
      if (!isNaN(day) && day >= 1 && day <= 31) {
        this.selectedDay = day;
      }
    }
  }

  weekdays(): string[] {
    return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  }

  // How many blank cells before day 1
  dayOffset(): number {
    return new Date(this.displayYear, this.displayMonth, 1).getDay();
  }

  days(): number[] {
    const daysInMonth = new Date(this.displayYear, this.displayMonth + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  }

  isSelectedDay(day: number): boolean {
    return (
      this.selectedYear === this.displayYear &&
      this.selectedMonth === this.displayMonth &&
      this.selectedDay === day
    );
  }

  isToday(day: number): boolean {
    const now = new Date();
    return (
      now.getFullYear() === this.displayYear &&
      now.getMonth() === this.displayMonth &&
      now.getDate() === day
    );
  }

  prevMonth(event: MouseEvent): void {
    event.stopPropagation();
    if (this.displayMonth === 0) {
      this.displayMonth = 11;
      this.displayYear--;
    } else {
      this.displayMonth--;
    }
  }

  nextMonth(event: MouseEvent): void {
    event.stopPropagation();
    if (this.displayMonth === 11) {
      this.displayMonth = 0;
      this.displayYear++;
    } else {
      this.displayMonth++;
    }
  }

  selectDay(day: number, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedYear = this.displayYear;
    this.selectedMonth = this.displayMonth;
    this.selectedDay = day;

    const m = this.displayMonth + 1;
    const mm = m < 10 ? `0${m}` : `${m}`;
    const dd = day < 10 ? `0${day}` : `${day}`;
    this.value = `${this.displayYear}-${mm}-${dd}`;
    this.valueChange.emit(this.value);
    this.open = false;
  }

  selectToday(event: MouseEvent): void {
    event.stopPropagation();
    const now = new Date();
    this.displayYear = now.getFullYear();
    this.displayMonth = now.getMonth();
    this.selectDay(now.getDate(), event);
  }

  clearDate(event: MouseEvent): void {
    event.stopPropagation();
    this.selectedYear = null;
    this.selectedMonth = null;
    this.selectedDay = null;
    this.value = '';
    this.valueChange.emit('');
    this.open = false;
  }

  // Drill-up to month/year selector
  goToYearView(event: MouseEvent): void {
    event.stopPropagation();
    this.baseYear = this.displayYear - (this.displayYear % 10);
    this.view = 'year';
  }

  // --- Year/Month drill-down (accessible via header click) ---
  years(): number[] {
    return Array.from({ length: 10 }, (_, i) => this.baseYear + i);
  }

  months(): { index: number; label: string }[] {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return labels.map((label, index) => ({ index, label }));
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
    this.displayYear = year;
    this.view = 'month';
  }

  selectMonth(monthIndex: number, event: MouseEvent): void {
    event.stopPropagation();
    this.displayMonth = monthIndex;
    this.view = 'day';
  }

  goUp(event: MouseEvent): void {
    event.stopPropagation();
    if (this.view === 'month') {
      this.view = 'year';
    } else if (this.view === 'day') {
      this.view = 'month';
    }
  }
}
