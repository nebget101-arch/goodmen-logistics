import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { InvoiceService } from '../../services/invoice.service';
import { CustomerService } from '../../services/customer.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-invoice-detail',
  templateUrl: './invoice-detail.component.html',
  styleUrls: ['./invoice-detail.component.css']
})
export class InvoiceDetailComponent implements OnInit {
  invoice: any;
  customer: any;
  location: any;
  workOrder: any;
  vehicle: any;
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

  constructor(
    private route: ActivatedRoute,
    private invoiceService: InvoiceService,
    private customerService: CustomerService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadInvoice(id);
  }

  loadInvoice(id: string): void {
    this.loading = true;
    this.invoiceService.getInvoice(id).subscribe({
      next: (res: any) => {
        this.invoice = res.invoice || res.data?.invoice || res.invoice;
        this.customer = res.customer || res.data?.customer;
        this.location = res.location || res.data?.location;
        this.workOrder = res.workOrder || res.data?.workOrder;
        this.vehicle = res.vehicle || res.data?.vehicle;
        this.lineItems = res.lineItems || res.data?.lineItems || [];
        this.payments = res.payments || res.data?.payments || [];
        this.documents = res.documents || res.data?.documents || [];
        this.loading = false;
        // If invoice has customer_id but backend didn't return customer (e.g. different service DB), fetch from customers API
        if (!this.customer && this.invoice?.customer_id) {
          this.customerService.getCustomer(this.invoice.customer_id).subscribe({
            next: (c: any) => { this.customer = c?.data ?? c ?? null; },
            error: () => {}
          });
        }
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
        const url = res?.downloadUrl ?? res?.data?.downloadUrl;
        if (!url) return;
        const fullUrl = this.getDownloadUrl(url);
        const fileName = `${this.invoice.invoice_number || 'invoice'}.pdf`;
        this.triggerPdfDownload(fullUrl, fileName);
      }
    });
  }

  private triggerPdfDownload(url: string, fileName: string): void {
    fetch(url, { mode: 'cors' })
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        window.open(url, '_blank');
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
    if (doc?.downloadUrl) {
      return this.getDownloadUrl(doc.downloadUrl);
    }
    if (doc?.id && this.invoice?.id) {
      return this.getDownloadUrl(`/api/invoices/${this.invoice.id}/documents/${doc.id}/download`);
    }
    return '';
  }

  joinAddress(c: any): string {
    if (!c) return '';
    return [c.billing_city, c.billing_state, c.billing_zip].filter(x => x != null && x !== '').join(', ');
  }

  joinYearMakeModel(v: any): string {
    if (!v) return '';
    return [v.year, v.make, v.model].filter(x => x != null && x !== '').join(' ');
  }
}
