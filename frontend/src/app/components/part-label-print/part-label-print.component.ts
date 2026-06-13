import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import * as JsBarcode from 'jsbarcode';

export interface PartLabelInput {
  name?: string;
  sku?: string;
  barcode?: string;
}

@Component({
  selector: 'app-part-label-print',
  templateUrl: './part-label-print.component.html',
  styleUrls: ['./part-label-print.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PartLabelPrintComponent implements AfterViewInit, OnChanges {
  @Input() part: PartLabelInput | null = null;

  @ViewChild('barcodeSvg', { static: false }) barcodeSvg?: ElementRef<SVGSVGElement>;

  qrSvgMarkup = '';
  renderError = '';

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.render();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['part'] && !changes['part'].firstChange) {
      this.render();
    }
  }

  get barcodeValue(): string {
    return (this.part?.barcode || '').trim();
  }

  private render(): void {
    const value = this.barcodeValue;
    this.renderError = '';
    this.qrSvgMarkup = '';
    if (!value) {
      return;
    }

    try {
      if (this.barcodeSvg?.nativeElement) {
        JsBarcode(this.barcodeSvg.nativeElement, value, {
          format: 'CODE128',
          displayValue: false,
          margin: 0,
          height: 60,
          width: 2,
        });
      }
    } catch (err: any) {
      this.renderError = `Could not render barcode: ${err?.message || err}`;
    }

    import('qrcode').then(QRCode => QRCode.toString(value, { type: 'svg', margin: 1, width: 120 }))
      .then((svg: string) => {
        this.qrSvgMarkup = svg;
        this.cdr.markForCheck();
      })
      .catch((err: any) => {
        this.renderError = `Could not render QR: ${err?.message || err}`;
        this.cdr.markForCheck();
      });
  }
}
