import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AgreementService } from '../agreement.service';
import {
  AgreementField,
  AgreementFieldRole,
  AgreementFieldType,
  AgreementTemplate,
  roleLabel,
} from '../agreement.model';
import {
  Bbox,
  PageGeometry,
  PixelRect,
  PlacementField,
  ResizeHandle,
  MIN_BBOX_SIZE_PTS,
  bboxToPixels,
  pixelsToBbox,
  pxToPts,
  fieldsOnPage,
  toPlacementFields,
  moveField,
  resizeField,
  addField,
  deleteField,
  updateFieldMeta,
  toSavePayload,
  hasPendingChanges,
  makeLocalIdGen,
} from './bbox-editor.logic';

/** Live drag/resize/draw interaction state (pointer-driven). */
interface Interaction {
  kind: 'move' | 'resize' | 'draw';
  localId?: string;
  handle?: ResizeHandle;
  /** Last pointer position — deltas are applied incrementally from here. */
  lastClientX: number;
  lastClientY: number;
  /** Draw mode: live rectangle in overlay-relative pixels. */
  drawStart?: { x: number; y: number };
  drawRect?: PixelRect;
  moved?: boolean;
}

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Fallback page size (US Letter, points) when the PDF can't be rasterized. */
const FALLBACK_PAGE: PageGeometry = { widthPts: 612, heightPts: 792 };

/** Target on-screen width (CSS px) for the rendered page. */
const TARGET_PAGE_WIDTH_PX = 820;

/**
 * FN-1807 — visual bbox field-placement editor (story FN-1806).
 *
 * Renders each source-doc page (pdf.js → canvas) and overlays the template's
 * field map as draggable / resizable boxes. The user can move, resize, add
 * (draw a rectangle), and delete boxes, plus edit each field's label / type /
 * role. Save persists `page` + `bbox` + adds/deletes via the field-map endpoint
 * (FN-1808). All geometry math + edit reducers live in `bbox-editor.logic.ts`
 * (unit-tested); this component is the thin pdf.js + pointer-event shell.
 *
 * Coordinate convention: `bbox = [x, y, w, h]` in PDF points, top-left origin —
 * shared with the FN-1797 signed-PDF overlay. See bbox-editor.logic.ts and
 * docs/design/agreements-bbox-coordinates.md (authoritative, owned by FN-1808).
 */
@Component({
  selector: 'app-agreement-placement',
  templateUrl: './agreement-placement.component.html',
  styleUrls: ['./agreement-placement.component.css'],
})
export class AgreementPlacementComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('pageCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('overlay') overlayRef?: ElementRef<HTMLDivElement>;

  templateId = '';
  template: AgreementTemplate | null = null;
  fields: PlacementField[] = [];
  pages: PageGeometry[] = [];

  pageCount = 0;
  currentPage = 1;
  /** Rendered-page scale: CSS pixels per PDF point. */
  pxPerPoint = 1;
  renderedWidth = 0;
  renderedHeight = 0;

  selectedLocalId: string | null = null;
  drawMode = false;

  loading = false;
  rendering = false;
  saving = false;
  loadError = '';
  saveError = '';
  saveNotice = '';
  /** Set when the PDF could not be rasterized — boxes editable over a blank surface. */
  previewUnavailable = false;

  readonly roleLabel = roleLabel;
  readonly handles = RESIZE_HANDLES;
  readonly fieldTypes: AgreementFieldType[] = [
    'text', 'date', 'number', 'checkbox', 'signature', 'initials',
  ];

  private idgen = makeLocalIdGen();
  private interaction: Interaction | null = null;
  // pdf.js document proxy (typed loosely to avoid importing pdf.js types eagerly).
  private pdfDoc: any = null;
  private viewReady = false;
  private destroyed = false;

  constructor(
    private agreements: AgreementService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.templateId = this.route.snapshot.paramMap.get('id') || '';
    if (this.templateId) this.load();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    // If data already arrived, render now that the canvas exists.
    if (this.pdfDoc || this.previewUnavailable) this.renderCurrentPage();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    try {
      this.pdfDoc?.destroy?.();
    } catch {
      /* noop */
    }
  }

  // ── Load template + PDF ─────────────────────────────────────────────────
  load(): void {
    this.loading = true;
    this.loadError = '';
    this.agreements.getTemplate(this.templateId).subscribe({
      next: (res) => {
        this.template = res;
        this.loadSource(res.fields || [], res.pageCount || 0);
      },
      error: (err) => {
        this.loadError = err?.error?.error || 'Could not load the template.';
        this.loading = false;
      },
    });
  }

  /**
   * Fetch the source bytes through the auth-gated backend proxy (FN-1839) and
   * render them. pdf.js can't fetch the R2 presigned URL directly (the bucket
   * has no CORS policy for the app origin), so we pull the bytes via HttpClient
   * — which carries the auth token and yields a CORS-clean response — and hand
   * the ArrayBuffer to pdf.js. A failed fetch degrades to the blank-page editor.
   */
  private loadSource(serverFields: AgreementField[], serverPageCount: number): void {
    this.agreements.getTemplateSource(this.templateId).subscribe({
      next: (data) => this.openPdf(data, serverFields, serverPageCount),
      error: () => this.openPdf(null, serverFields, serverPageCount),
    });
  }

  /** Load the PDF with pdf.js, measure pages, then build the field model. */
  private async openPdf(
    data: ArrayBuffer | null,
    serverFields: AgreementField[],
    serverPageCount: number
  ): Promise<void> {
    try {
      if (!data || data.byteLength === 0) throw new Error('no source bytes');
      const pdfjs: any = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.js';

      const doc = await pdfjs.getDocument({ data }).promise;
      if (this.destroyed) {
        doc.destroy?.();
        return;
      }
      this.pdfDoc = doc;
      this.pageCount = doc.numPages || 1;

      const pages: PageGeometry[] = [];
      for (let i = 1; i <= this.pageCount; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        pages[i - 1] = { widthPts: vp.width, heightPts: vp.height };
      }
      this.pages = pages;
    } catch {
      // Graceful degradation: edit boxes over a blank, correctly-proportioned page.
      this.previewUnavailable = true;
      this.pageCount = Math.max(1, serverPageCount || 1);
      this.pages = Array.from({ length: this.pageCount }, () => ({ ...FALLBACK_PAGE }));
    }

    this.fields = toPlacementFields(serverFields, this.pages, this.idgen);
    this.currentPage = 1;
    this.loading = false;
    // Defer a tick so *ngIf renders the canvas before we draw to it.
    setTimeout(() => this.renderCurrentPage(), 0);
  }

  // ── Page rendering ──────────────────────────────────────────────────────
  async renderCurrentPage(): Promise<void> {
    if (!this.viewReady) return;
    const geom = this.currentPageGeom();

    if (this.previewUnavailable || !this.pdfDoc) {
      // Size the surface to the page aspect ratio at the target width.
      this.pxPerPoint = TARGET_PAGE_WIDTH_PX / geom.widthPts;
      this.renderedWidth = TARGET_PAGE_WIDTH_PX;
      this.renderedHeight = geom.heightPts * this.pxPerPoint;
      this.clearCanvas();
      return;
    }

    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    this.rendering = true;
    try {
      const page = await this.pdfDoc.getPage(this.currentPage);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = TARGET_PAGE_WIDTH_PX / unscaled.width;
      const viewport = page.getViewport({ scale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }

      this.pxPerPoint = scale;
      this.renderedWidth = canvas.width;
      this.renderedHeight = canvas.height;
    } catch {
      this.previewUnavailable = true;
    } finally {
      this.rendering = false;
    }
  }

  private clearCanvas(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    canvas.width = this.renderedWidth;
    canvas.height = this.renderedHeight;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  currentPageGeom(): PageGeometry {
    return this.pages[this.currentPage - 1] || FALLBACK_PAGE;
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.pageCount);
    if (next === this.currentPage) return;
    this.currentPage = next;
    this.selectedLocalId = null;
    this.renderCurrentPage();
  }

  // ── Box geometry for the overlay ────────────────────────────────────────
  get visibleFields(): PlacementField[] {
    return fieldsOnPage(this.fields, this.currentPage);
  }

  boxStyle(field: PlacementField): Record<string, string> {
    const r: PixelRect = bboxToPixels(field.bbox, this.pxPerPoint);
    return {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    };
  }

  get selectedField(): PlacementField | null {
    return this.fields.find((f) => f.localId === this.selectedLocalId) || null;
  }

  selectField(localId: string | null): void {
    this.selectedLocalId = localId;
  }

  isSelected(field: PlacementField): boolean {
    return field.localId === this.selectedLocalId;
  }

  // ── Pointer interaction: move / resize / draw ───────────────────────────
  onBoxPointerDown(event: PointerEvent, field: PlacementField): void {
    if (this.drawMode) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectField(field.localId);
    this.interaction = {
      kind: 'move',
      localId: field.localId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    this.capture(event);
  }

  onHandlePointerDown(event: PointerEvent, field: PlacementField, handle: ResizeHandle): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectField(field.localId);
    this.interaction = {
      kind: 'resize',
      localId: field.localId,
      handle,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    this.capture(event);
  }

  /** Pointer-down on empty overlay: start drawing a new box (draw mode only). */
  onOverlayPointerDown(event: PointerEvent): void {
    if (!this.drawMode) {
      this.selectField(null);
      return;
    }
    event.preventDefault();
    const origin = this.overlayPoint(event);
    this.interaction = {
      kind: 'draw',
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      drawStart: origin,
      drawRect: { left: origin.x, top: origin.y, width: 0, height: 0 },
    };
    this.capture(event);
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    const it = this.interaction;
    if (!it) return;
    const geom = this.currentPageGeom();

    if (it.kind === 'draw') {
      const p = this.overlayPoint(event);
      const s = it.drawStart!;
      it.drawRect = {
        left: Math.min(s.x, p.x),
        top: Math.min(s.y, p.y),
        width: Math.abs(p.x - s.x),
        height: Math.abs(p.y - s.y),
      };
      it.moved = true;
      return;
    }

    const dxPts = pxToPts(event.clientX - it.lastClientX, this.pxPerPoint);
    const dyPts = pxToPts(event.clientY - it.lastClientY, this.pxPerPoint);
    it.lastClientX = event.clientX;
    it.lastClientY = event.clientY;
    it.moved = true;

    if (it.kind === 'move') {
      this.fields = moveField(this.fields, it.localId!, dxPts, dyPts, geom);
    } else if (it.kind === 'resize') {
      this.fields = resizeField(this.fields, it.localId!, it.handle!, dxPts, dyPts, geom);
    }
  }

  @HostListener('document:pointerup', ['$event'])
  onPointerUp(event: PointerEvent): void {
    const it = this.interaction;
    if (!it) return;
    this.interaction = null;

    if (it.kind === 'draw' && it.drawRect) {
      const rect = it.drawRect;
      // Ignore an accidental click (too small to be a deliberate box).
      const minPx = MIN_BBOX_SIZE_PTS * this.pxPerPoint;
      if (rect.width >= minPx && rect.height >= minPx) {
        const bbox: Bbox = pixelsToBbox(rect, this.pxPerPoint);
        const localId = this.idgen();
        this.fields = addField(this.fields, {
          localId,
          page: this.currentPage,
          bbox,
          pageGeom: this.currentPageGeom(),
        });
        this.selectField(localId);
        this.drawMode = false;
      }
    }
  }

  private capture(event: PointerEvent): void {
    try {
      (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
    } catch {
      /* noop */
    }
  }

  private overlayPoint(event: PointerEvent): { x: number; y: number } {
    const el = this.overlayRef?.nativeElement;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Live draw-preview rectangle (or null when not drawing). */
  get drawPreview(): PixelRect | null {
    return this.interaction?.kind === 'draw' ? this.interaction.drawRect || null : null;
  }

  // ── Toolbar / field actions ─────────────────────────────────────────────
  toggleDrawMode(): void {
    this.drawMode = !this.drawMode;
    if (this.drawMode) this.selectField(null);
  }

  deleteSelected(): void {
    if (!this.selectedLocalId) return;
    this.fields = deleteField(this.fields, this.selectedLocalId);
    this.selectField(null);
  }

  deleteFieldByLocalId(localId: string): void {
    this.fields = deleteField(this.fields, localId);
    if (this.selectedLocalId === localId) this.selectField(null);
  }

  setRole(field: PlacementField, role: AgreementFieldRole): void {
    this.fields = updateFieldMeta(this.fields, field.localId, { role });
  }

  setType(field: PlacementField, fieldType: AgreementFieldType): void {
    this.fields = updateFieldMeta(this.fields, field.localId, { fieldType });
  }

  setLabel(field: PlacementField, label: string): void {
    this.fields = updateFieldMeta(this.fields, field.localId, { label });
  }

  /** Select a field from the side list and jump to its page. */
  focusField(field: PlacementField): void {
    if (field.page !== this.currentPage) this.goToPage(field.page);
    this.selectField(field.localId);
  }

  // ── Display helpers ─────────────────────────────────────────────────────
  isLowConfidence(field: PlacementField): boolean {
    return field.lowConfidence === true;
  }

  confidencePercent(field: PlacementField): number | null {
    const c = field.confidence;
    return c == null || !Number.isFinite(c) ? null : Math.round(c * 100);
  }

  typeIcon(type: AgreementFieldType): string {
    switch (type) {
      case 'date': return 'calendar_today';
      case 'number': return 'tag';
      case 'checkbox': return 'check_box';
      case 'signature': return 'draw';
      case 'initials': return 'edit';
      default: return 'text_fields';
    }
  }

  get hasChanges(): boolean {
    return hasPendingChanges(this.fields);
  }

  trackByLocalId(_i: number, field: PlacementField): string {
    return field.localId;
  }

  // ── Save ────────────────────────────────────────────────────────────────
  save(finalize = false): void {
    if (this.saving) return;
    this.saveError = '';
    this.saveNotice = '';

    const payload = toSavePayload(this.fields);
    const nothingToDo =
      !payload.fields.length && !payload.adds.length && !payload.deletes.length;
    if (nothingToDo && !finalize) {
      this.saveNotice = 'No placement changes to save.';
      return;
    }

    this.saving = true;
    this.agreements.savePlacement(this.templateId, payload, finalize).subscribe({
      next: (res) => {
        this.saving = false;
        this.template = res;
        // Re-seed the editor from the persisted map (picks up new server ids).
        this.fields = toPlacementFields(res.fields || [], this.pages, this.idgen);
        this.selectField(null);
        if (finalize) {
          this.router.navigate(['/agreements']);
        } else {
          this.saveNotice = 'Placement saved.';
        }
      },
      error: (err) => {
        this.saving = false;
        this.saveError = err?.error?.error || 'Save failed. Please try again.';
      },
    });
  }

  backToReview(): void {
    this.router.navigate(['/agreements', this.templateId, 'review']);
  }
}
