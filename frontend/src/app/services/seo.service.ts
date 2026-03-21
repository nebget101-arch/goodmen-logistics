import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { SEO_PUBLIC } from './seo-public-presets';

const STRUCTURED_DATA_SCRIPT_ID = 'fleetneuron-structured-data';
const DEFAULT_SITE_NAME = 'FleetNeuron AI';
const DEFAULT_IMAGE_PATH = '/assets/fleetneuron-apple-touch.png';

export interface SeoConfig {
  title: string;
  description: string;
  /** Path starting with / for canonical and og:url (e.g. `/home`, `/login`). */
  path: string;
  /** Absolute URL, or path starting with / resolved against current origin. */
  imageUrl?: string;
  ogType?: 'website' | 'article';
  /** Use for transactional links that should not be indexed. */
  noindex?: boolean;
}

export interface SeoApplyOptions {
  /** When set, injects or replaces JSON-LD. When omitted, removes FleetNeuron JSON-LD if present. */
  jsonLd?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly doc = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  /** Landing page SEO plus Organization + Product JSON-LD (FN-1). */
  applyMarketingHome(): void {
    const origin = this.getOrigin();
    this.apply(SEO_PUBLIC.home, { jsonLd: this.buildHomePageJsonLd(origin) });
  }

  apply(config: SeoConfig, options?: SeoApplyOptions): void {
    const origin = this.getOrigin();
    const path = config.path.startsWith('/') ? config.path : `/${config.path}`;
    const pageUrl = `${origin}${path}`;
    const image = this.resolveImageUrl(origin, config.imageUrl);

    this.title.setTitle(config.title);

    this.meta.updateTag({ name: 'description', content: config.description });

    if (config.noindex) {
      this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    } else {
      this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    }

    this.meta.updateTag({ property: 'og:title', content: config.title });
    this.meta.updateTag({ property: 'og:description', content: config.description });
    this.meta.updateTag({ property: 'og:type', content: config.ogType ?? 'website' });
    this.meta.updateTag({ property: 'og:url', content: pageUrl });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:site_name', content: DEFAULT_SITE_NAME });
    this.meta.updateTag({ property: 'og:locale', content: 'en_US' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: config.title });
    this.meta.updateTag({ name: 'twitter:description', content: config.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.setCanonicalHref(pageUrl);

    if (options?.jsonLd) {
      this.setStructuredData(options.jsonLd);
    } else {
      this.clearStructuredData();
    }
  }

  /** Organization + Product JSON-LD for the marketing home page. */
  buildHomePageJsonLd(origin: string): Record<string, unknown> {
    const homeUrl = `${origin}/home`;
    const logoUrl = `${origin}${DEFAULT_IMAGE_PATH}`;
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${homeUrl}#organization`,
          name: DEFAULT_SITE_NAME,
          url: homeUrl,
          logo: logoUrl,
          description:
            'FleetNeuron AI helps motor carriers run safer, compliant operations with FMCSA-focused tools, dispatch, maintenance, and AI-assisted workflows.'
        },
        {
          '@type': 'Product',
          '@id': `${homeUrl}#product`,
          name: 'FleetNeuron AI Platform',
          description:
            'Cloud software for fleet management, driver qualification files, HOS, maintenance, loads, and compliance—built for trucking and logistics operators.',
          brand: {
            '@type': 'Brand',
            name: DEFAULT_SITE_NAME
          },
          category: 'BusinessApplication',
          url: homeUrl,
          image: logoUrl,
          offers: {
            '@type': 'Offer',
            availability: 'https://schema.org/OnlineOnly',
            priceCurrency: 'USD'
          }
        }
      ]
    };
  }

  private getOrigin(): string {
    const win = this.doc.defaultView;
    if (!win?.location?.origin) {
      return '';
    }
    return win.location.origin;
  }

  private resolveImageUrl(origin: string, imageUrl?: string): string {
    if (!imageUrl) {
      return `${origin}${DEFAULT_IMAGE_PATH}`;
    }
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return imageUrl;
    }
    const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
    return `${origin}${path}`;
  }

  private setCanonicalHref(href: string): void {
    const head = this.doc.head;
    if (!head) {
      return;
    }
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private setStructuredData(data: Record<string, unknown>): void {
    this.clearStructuredData();
    const script = this.doc.createElement('script');
    script.type = 'application/ld+json';
    script.id = STRUCTURED_DATA_SCRIPT_ID;
    script.textContent = JSON.stringify(data);
    this.doc.head?.appendChild(script);
  }

  private clearStructuredData(): void {
    this.doc.getElementById(STRUCTURED_DATA_SCRIPT_ID)?.remove();
  }
}
