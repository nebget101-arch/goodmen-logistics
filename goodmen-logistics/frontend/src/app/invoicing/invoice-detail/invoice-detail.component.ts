import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { InvoiceService } from '../../services/invoice.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-invoice-detail',
  templateUrl: './invoice-detail.component.html',
  styleUrls: ['./invoice-detail.component.css']
})
export class InvoiceDetailComponent implements OnInit {
  invoice: any;
  lineItems: any[] = [];
  payments: any[] = [];
  documents: any[] = [];
  loading = false;
  error = '';
  fileBaseUrl = environment.apiUrl.replace(/\/api\/?$/, '');

  paymentForm: any = {
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: null,
    method: 'CARD',
    referenceNumber: '',
    memo: ''
  };

  constructor(private route: ActivatedRoute, private invoiceService: InvoiceService) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadInvoice(id);
  }

  loadInvoice(id: string): void {
    this.loading = true;
    this.invoiceService.getInvoice(id).subscribe({
      next: (res: any) => {
        this.invoice = res.invoice || res.data?.invoice || res.invoice;
        this.lineItems = res.lineItems || res.data?.lineItems || [];
        this.payments = res.payments || res.data?.payments || [];
        this.documents = res.documents || res.data?.documents || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load invoice';
        this.loading = false;
      }
    });
  }

  markSent(): void {
    if (!this.invoice?.id) return;
    this.invoiceService.updateStatus(this.invoice.id, 'SENT').subscribe({
      next: () => this.loadInvoice(this.invoice.id)
    });
  }

  voidInvoice(): void {
    if (!this.invoice?.id) return;
    const reason = prompt('Reason for void?');
    if (!reason) return;
    this.invoiceService.updateStatus(this.invoice.id, 'VOID', reason).subscribe({
      next: () => this.loadInvoice(this.invoice.id)
    });
  }

  addPayment(): void {
    if (!this.invoice?.id) return;
    this.invoiceService.addPayment(this.invoice.id, this.paymentForm).subscribe({
      next: () => {
        this.paymentForm.amount = null;
        this.loadInvoice(this.invoice.id);
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to add payment';
      }
    });
  }

  generatePdf(): void {
    if (!this.invoice?.id) return;
    this.invoiceService.generatePdf(this.invoice.id).subscribe({
      next: () => this.loadInvoice(this.invoice.id)
    });
  }

  downloadPdf(): void {
    if (!this.invoice?.id) return;
    this.invoiceService.getPdf(this.invoice.id).subscribe({
      next: (res: any) => {
        if (res.downloadUrl) {
          window.open(this.getDownloadUrl(res.downloadUrl), '_blank');
        }
      }
    });
  }

  uploadDoc(event: any): void {
    const file = event.target.files?.[0];
    if (!file || !this.invoice?.id) return;
    this.invoiceService.uploadDocument(this.invoice.id, file).subscribe({
      next: () => this.loadInvoice(this.invoice.id)
    });
  }

  getDownloadUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const base = this.fileBaseUrl.endsWith('/') ? this.fileBaseUrl.slice(0, -1) : this.fileBaseUrl;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalized}`;
  }

  getDocumentUrl(doc: any): string {
    if (doc?.storage_key) {
      return this.getDownloadUrl(`/uploads/${doc.storage_key}`);
    }
    if (doc?.id && this.invoice?.id) {
      return this.getDownloadUrl(`/api/invoices/${this.invoice.id}/documents/${doc.id}/download`);
    }
    return '';
  }
}
