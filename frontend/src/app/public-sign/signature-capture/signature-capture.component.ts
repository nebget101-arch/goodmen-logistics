import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { SignatureType } from '../../agreements/signature-request.model';

/** What the capture component emits to its host. `null` = no signature yet. */
export interface SignatureValue {
  value: string;
  type: SignatureType;
}

/**
 * FN-1798 — reusable e-signature capture.
 *
 * Two modes:
 *  - `typed` (default): the signer's typed legal name IS the signature; we render
 *    it in a script face as a preview and emit `{ value: name, type: 'typed' }`.
 *  - `drawn`: a canvas the signer draws on (mouse / touch); emits a PNG data-URL.
 *
 * Stateless about identity — the host supplies the typed name via `typedName`
 * (so the name is collected once) and listens to `signatureChange`.
 */
@Component({
  selector: 'app-signature-capture',
  templateUrl: './signature-capture.component.html',
  styleUrls: ['./signature-capture.component.css'],
})
export class SignatureCaptureComponent implements OnChanges {
  /** The signer's typed legal name, used as the signature in `typed` mode. */
  @Input() typedName = '';
  @Input() disabled = false;

  @Output() signatureChange = new EventEmitter<SignatureValue | null>();

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  mode: SignatureType = 'typed';
  hasDrawing = false;

  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['typedName'] && this.mode === 'typed') {
      this.emitTyped();
    }
  }

  setMode(mode: SignatureType): void {
    if (this.disabled || this.mode === mode) return;
    this.mode = mode;
    if (mode === 'typed') {
      this.emitTyped();
    } else {
      // Defer until the canvas is in the DOM, then init.
      setTimeout(() => this.initCanvas());
      this.emitDrawn();
    }
  }

  private emitTyped(): void {
    const name = (this.typedName || '').trim();
    this.signatureChange.emit(name ? { value: name, type: 'typed' } : null);
  }

  private emitDrawn(): void {
    if (!this.hasDrawing || !this.canvasRef) {
      this.signatureChange.emit(null);
      return;
    }
    const dataUrl = this.canvasRef.nativeElement.toDataURL('image/png');
    this.signatureChange.emit({ value: dataUrl, type: 'drawn' });
  }

  // ── Canvas drawing ──────────────────────────────────────────────────────
  private initCanvas(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    // Size the backing store to the rendered size for crisp strokes.
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || 480;
    canvas.height = rect.height || 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    this.ctx = ctx;
  }

  private pointerPos(ev: MouseEvent | TouchEvent): { x: number; y: number } {
    const canvas = this.canvasRef!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    // Feature-detect touch rather than `instanceof TouchEvent` — that constructor
    // is undefined on some desktop browsers (e.g. Safari) and would throw.
    const touch = (ev as TouchEvent).touches;
    const point = touch && touch.length
      ? touch[0]
      : (ev as TouchEvent).changedTouches?.[0] || (ev as MouseEvent);
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  startDraw(ev: MouseEvent | TouchEvent): void {
    if (this.disabled || this.mode !== 'drawn') return;
    ev.preventDefault();
    if (!this.ctx) this.initCanvas();
    const { x, y } = this.pointerPos(ev);
    this.drawing = true;
    this.lastX = x;
    this.lastY = y;
  }

  moveDraw(ev: MouseEvent | TouchEvent): void {
    if (!this.drawing || !this.ctx) return;
    ev.preventDefault();
    const { x, y } = this.pointerPos(ev);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.lastX = x;
    this.lastY = y;
    this.hasDrawing = true;
  }

  endDraw(): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.hasDrawing) this.emitDrawn();
  }

  clear(): void {
    if (this.ctx && this.canvasRef) {
      const c = this.canvasRef.nativeElement;
      this.ctx.clearRect(0, 0, c.width, c.height);
    }
    this.hasDrawing = false;
    this.signatureChange.emit(null);
  }
}
