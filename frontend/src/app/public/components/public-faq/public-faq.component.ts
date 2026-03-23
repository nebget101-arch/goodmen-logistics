import { Component, Input } from '@angular/core';
import { MARKETING_FAQ, MarketingFaqItem } from '../../config/marketing.config';

@Component({
  selector: 'app-public-faq',
  templateUrl: './public-faq.component.html',
  styleUrls: ['./public-faq.component.css']
})
export class PublicFaqComponent {
  /** `marketing` = landing page spacing; `contact` = tighter padding inside contact shell */
  @Input() layout: 'marketing' | 'contact' = 'marketing';

  readonly items: MarketingFaqItem[] = MARKETING_FAQ;
}
