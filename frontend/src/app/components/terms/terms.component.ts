import { Component, OnInit } from '@angular/core';
import { SeoService } from '../../services/seo.service';
import { SEO_PUBLIC } from '../../services/seo-public-presets';

@Component({
  selector: 'app-terms',
  templateUrl: './terms.component.html',
  styleUrls: ['./terms.component.css']
})
export class TermsComponent implements OnInit {
  updatedDate = '2026-03-21';

  constructor(private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.apply(SEO_PUBLIC.terms);
  }
}
