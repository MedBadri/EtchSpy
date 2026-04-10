// content_etsy_listing.js — injected on https://www.etsy.com/listing/*
// Depends on: storage.js, license.js, csv_export.js (loaded first via manifest)
'use strict';

if (!window.__etchspy_listing_injected) {
  window.__etchspy_listing_injected = true;
  etchspyListing();
}

function etchspyListing() {

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTOR LIBRARY — four-tier cascade (data-attr > aria > class > structure)
  // ═══════════════════════════════════════════════════════════════════════════

  const SEL = {
    title: [
      'h1[data-buy-box-listing-title]',
      'h1[class*="title"]',
      'h1',
      '[itemprop="name"]',
    ],

    price: [
      '[data-buy-box-region] .currency-value',
      '[class*="currency-value"]',
      '[data-buy-box-region] [class*="price"]',
      'p[class*="price"] .currency-value',
      '[itemprop="price"]',
    ],

    // "(1,234 reviews)" link or span — prioritise the global total near the star
    // rating at the top, NOT the per-variant count near the style selector
    reviewsText: [
      '[data-reviews-count]',
      'a[href*="#reviews"][class*="reviews"]',
      '[class*="listing-page-reviews"] a',
      '[class*="review-count"]',
      'a[href*="#reviews"]',
      '[class*="reviews-section"] a',
      'div[class*="stars"] a',
    ],

    rating: [
      'input[name="rating"][checked]',
      '[class*="stars"] [aria-label*="out of"]',
      '[title*="out of 5 stars"]',
      '[class*="rating-value"]',
    ],

    favorites: [
      '[class*="wishlist-count"]',
      'span[class*="favorite-count"]',
      '[aria-label*="favorites"]',
      'button[class*="favorite"] span',
    ],

    // Tags section — Etsy shows them at the bottom under "Explore related"
    tags: [
      '[data-search-tags] a',
      'a[href*="/search?q="]',
      '[class*="tags-list"] a',
      '[class*="tag-list"] a',
    ],

    shopName: [
      '[data-shop-name]',
      'a[href*="/shop/"] span',
      '[class*="shop-name"] a',
      '.shop-name a',
      'a[href*="/shop/"]',
    ],

    shopUrl: [
      'a[href*="/shop/"]',
    ],

    // Bestseller badge
    bestsellerBadge: [
      '[class*="bestseller"]',
      '[aria-label*="Bestseller"]',
      '[title*="Bestseller"]',
    ],

    // Panel insertion anchor — inject our panel after this element
    insertAfter: [
      '[data-buy-box-region]',
      'div[class*="listing-page-image"]',
      '[class*="listing-essential-info"]',
      '#listing-page-cart',
      'main',
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function queryOne(context, selectors) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el) {
          console.log(`[EtchSpy listing] selector hit: "${sel}"`);
          return el;
        }
      } catch (_) {}
    }
    return null;
  }

  function queryAll(context, selectors) {
    for (const sel of selectors) {
      try {
        const els = context.querySelectorAll(sel);
        if (els.length > 0) return Array.from(els);
      } catch (_) {}
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // JSON-LD STRUCTURED DATA — most reliable source for price + review count
  // Etsy embeds schema.org Product JSON-LD on every listing page.
  // ═══════════════════════════════════════════════════════════════════════════

  function extractFromJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        let data;
        try { data = JSON.parse(script.textContent); } catch (_) { continue; }

        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item['@type'] !== 'Product') continue;

          const result = {};

          // Price — prefer lowPrice (for variants), fall back to price
          const offers = item.offers;
          if (offers) {
            const raw = offers.lowPrice ?? offers.price ?? null;
            if (raw != null) {
              const val = parseFloat(String(raw).replace(/,/g, ''));
              if (val > 0) result.price = val;
            }
          }

          // Review count — prefer ratingCount (total reviews) over reviewCount
          const agg = item.aggregateRating;
          if (agg) {
            const raw = agg.ratingCount ?? agg.reviewCount ?? null;
            if (raw != null) {
              const val = parseInt(String(raw).replace(/,/g, ''), 10);
              if (val > 0) result.review_count = val;
            }
          }

          // Rating value
          if (agg && agg.ratingValue) {
            result.rating = parseFloat(agg.ratingValue);
          }

          // NOTE: intentionally NOT using datePublished/dateCreated from JSON-LD.
          // Etsy renews listings every ~4 months and resets that field to the renewal
          // date, not the original listing date — it would always give a wrong age.

          if (result.price || result.review_count) {
            console.log('[EtchSpy listing] JSON-LD hit:', result);
            return result;
          }
        }
      }
    } catch (err) {
      console.warn('[EtchSpy listing] JSON-LD parse error:', err);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  function extractTitle() {
    const el = queryOne(document, SEL.title);
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : document.title.split('|')[0].trim();
  }

  function extractPrice() {
    const el = queryOne(document, SEL.price);
    if (!el) return 0;
    const text = el.closest('[class*="price"]')
      ? el.closest('[class*="price"]').textContent
      : el.textContent;
    const nums = text.match(/[\d,]+\.?\d*/g);
    if (!nums) return 0;
    const vals = nums.map((n) => parseFloat(n.replace(/,/g, ''))).filter((n) => n > 0);
    return vals.length ? Math.min(...vals) : 0;
  }

  // Parses numbers like "7.3k" → 7300, "1.2K" → 1200, "1,234" → 1234
  function parseKNumber(text) {
    if (!text) return 0;
    const kMatch = text.match(/([\d.]+)\s*[kK]/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const plain = text.match(/[\d,]+/);
    return plain ? parseInt(plain[0].replace(/,/g, ''), 10) : 0;
  }

  function extractReviewCount() {
    // Etsy listing pages show TWO review counts:
    //   1. The global total (e.g. 2,600) near the star rating at the top
    //   2. A per-variant count (e.g. 11) inside the style/option selector area
    // We want the global total, which is always the largest "X reviews" value on the page.
    // Strategy: find every "X reviews" / "X ratings" / "(Xk)" string in the page text
    // and take the maximum — review-formatted text won't collide with prices or IDs.

    const candidates = [];

    // Pass 1: explicit selectors (all matching elements, not just the first)
    for (const sel of SEL.reviewsText) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          const text = el.textContent + ' ' + (el.getAttribute('aria-label') || '');
          const kMatch = text.match(/([\d.]+[kK])/);
          if (kMatch) { candidates.push(parseKNumber(kMatch[1])); continue; }
          const m = text.match(/[\d,]+/);
          if (m) candidates.push(parseInt(m[0].replace(/,/g, ''), 10));
        }
      } catch (_) {}
    }

    // Pass 2: full-page scan for review-formatted text only
    // These patterns are specific enough that they won't match prices, IDs, etc.
    const reviewRe = [
      /([\d.,]+[kK]?)\s+reviews?/gi,
      /([\d.,]+[kK]?)\s+ratings?/gi,
      /\(([\d.,]+[kK]?)\s+reviews?\)/gi,
    ];
    const bodyText = document.body.textContent;
    for (const re of reviewRe) {
      let m;
      while ((m = re.exec(bodyText)) !== null) {
        const n = parseKNumber(m[1]);
        if (n > 0) candidates.push(n);
      }
    }

    const valid = candidates.filter((n) => n > 0);
    return valid.length > 0 ? Math.max(...valid) : 0;
  }

  function extractRating() {
    const el = queryOne(document, SEL.rating);
    if (!el) return null;
    const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent;
    const m = label.match(/([\d.]+)\s*out of\s*5/i) || label.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  function extractFavorites() {
    const el = queryOne(document, SEL.favorites);
    if (!el) return 0;
    const m = el.textContent.match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
  }

  function extractShopName() {
    const el = queryOne(document, SEL.shopName);
    if (!el) return '';
    return el.textContent.trim().replace(/^by\s+/i, '');
  }

  function extractShopUrl() {
    const el = queryOne(document, SEL.shopUrl);
    if (!el) return '';
    try {
      const u = new URL(el.href);
      return u.origin + u.pathname;
    } catch (_) {
      return el.href || '';
    }
  }

  function extractTags() {
    const els = queryAll(document, SEL.tags);
    const seen = new Set();
    return els
      .map((el) => el.textContent.trim())
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .slice(0, 20); // cap at 20 tags
  }

  function extractIsBestseller() {
    return !!queryOne(document, SEL.bestsellerBadge);
  }

  // ── Exact listing date extraction ──────────────────────────────────────────
  // Returns age in months if a concrete date is found, otherwise null.
  function extractListingDate() {
    const body = document.body.textContent;

    // "Listed on Dec 4, 2019" or "Listed on December 4, 2019"
    const full = body.match(/[Ll]isted\s+on\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (full) {
      const d = new Date(`${full[1]} ${full[2]}, ${full[3]}`);
      const age = _monthsAgo(d);
      if (age) return age;
    }

    // "Listed on Dec 2019" or "Listed on December 2019"
    const monthYear = body.match(/[Ll]isted\s+on\s+([A-Za-z]+)\s+(\d{4})/);
    if (monthYear) {
      const d = new Date(`${monthYear[1]} 1, ${monthYear[2]}`);
      const age = _monthsAgo(d);
      if (age) return age;
    }

    return null;
  }

  function _monthsAgo(date) {
    if (!date || isNaN(date.getTime())) return null;
    const now = new Date();
    const m = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    return (m > 0 && m < 360) ? m : null;
  }

  // Estimate listing age — exact "Listed on" date first, then review-count tiers.
  // IMPORTANT: Etsy shows the *renewal* date in "Listed on" text, not the original
  // creation date. We sanity-check it: if the date implies more than 150 reviews/month
  // it's almost certainly a renewal date, so we ignore it and fall through to tiers.
  function estimateListingAge(reviewCount) {
    const exact = extractListingDate();
    if (exact !== null) {
      const impliedRate = exact > 0 ? reviewCount / exact : Infinity;
      if (impliedRate <= 150) return exact; // plausible — use it
      // else: renewal date — fall through to tiers
      console.log(`[EtchSpy listing] Ignoring renewal date (${exact} mo, ${Math.round(impliedRate)} reviews/mo implied)`);
    }

    // Review-count tiers — calibrated to real Etsy listing growth curves.
    // More tiers at the high end since popular listings accumulate reviews over years.
    if (reviewCount <    10) return  3;
    if (reviewCount <   100) return  8;
    if (reviewCount <   500) return 14;
    if (reviewCount <  2000) return 24;
    if (reviewCount <  8000) return 36;
    if (reviewCount < 20000) return 54;
    return 72; // 6 years — realistic for 20k+ review listings
  }

  // ── Category-based review rate ──────────────────────────────────────────────
  // Uses the same title-keyword logic as the search page so search badge and
  // listing panel always agree on the rate for the same listing.
  //
  //  Digital downloads   → ~2.5%
  //  Personalized/custom → ~8.5%
  //  Default physical    → ~4.0%
  function detectReviewRate() {
    const title = extractTitle().toLowerCase();
    if (/\bdigital\b|\bdownload\b|\bprintable\b|\bsvg\b|\bpdf\b|\binstant\b/.test(title)) return 0.025;
    if (/personali|custom|\bengraved\b|wedding|memorial|sympathy|baby\s*shower|engagement|bespoke/.test(title)) return 0.085;
    return 0.04;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTIMATES
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateEstimates(reviews, price, ageMonths, reviewRate = 0.04) {
    const est_total_sales     = reviews / reviewRate;
    const est_monthly_sales   = ageMonths > 0 ? est_total_sales / ageMonths : 0;
    const est_monthly_revenue = est_monthly_sales * price;
    return { est_total_sales, est_monthly_sales, est_monthly_revenue };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PANEL RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  // Safe formatters — never produce NaN or undefined in the UI
  function safeRound(n) { const v = Math.round(n || 0); return isFinite(v) ? v : 0; }
  function fmt(n)  { return safeRound(n).toLocaleString(); }
  function fmtD(n) { return n > 0 ? '$' + safeRound(n).toLocaleString() : '—'; }
  function fmtPrice(n) { return n > 0 ? '$' + Number(n).toFixed(2) : '—'; }

  function renderPanel(data) {
    const {
      title, price, review_count, rating, favorites, shop_name, shop_url,
      listing_age_months, tags, is_bestseller, listing_url,
      est_total_sales, est_monthly_sales, est_monthly_revenue,
    } = data;

    const noData = review_count === 0;

    const tagsHtml = tags.length > 0
      ? tags.map((t) => `<span class="etchspy-tag">${t}</span>`).join('')
      : '<span class="etchspy-secondary">None detected</span>';

    const ratingHtml = rating != null
      ? `${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))} ${rating.toFixed(1)}`
      : 'N/A';

    const panel = document.createElement('div');
    panel.id = 'etchspy-listing-panel';
    panel.setAttribute('data-etchspy', 'true');

    panel.innerHTML = `
      <div class="etchspy-panel-header">
        <span class="etchspy-panel-logo">📊 EtchSpy Analysis</span>
        ${is_bestseller ? '<span class="etchspy-bestseller-badge">🏆 Bestseller</span>' : ''}
        <button class="etchspy-panel-close" id="etchspy-panel-close">✕</button>
      </div>

      <div class="etchspy-panel-grid">
        ${noData ? `
          <div class="etchspy-panel-new-listing">
            📦 <strong>New listing</strong> — No reviews yet. Check back once sales have started.
          </div>
        ` : `
          <div class="etchspy-panel-stat">
            <span class="etchspy-stat-label">Est. Total Sales</span>
            <span class="etchspy-stat-value">~${fmt(est_total_sales)}</span>
          </div>
          <div class="etchspy-panel-stat">
            <span class="etchspy-stat-label">Est. Monthly Sales</span>
            <span class="etchspy-stat-value">~${fmt(est_monthly_sales)}/mo</span>
          </div>
          <div class="etchspy-panel-stat etchspy-panel-stat--highlight">
            <span class="etchspy-stat-label">Est. Monthly Revenue</span>
            <span class="etchspy-stat-value">~${fmtD(est_monthly_revenue)}/mo</span>
          </div>
          <div class="etchspy-panel-stat">
            <span class="etchspy-stat-label">Listing Age</span>
            <span class="etchspy-stat-value">~${listing_age_months} months</span>
          </div>
        `}
        <div class="etchspy-panel-stat">
          <span class="etchspy-stat-label">Reviews</span>
          <span class="etchspy-stat-value">${fmt(review_count)}</span>
        </div>
        <div class="etchspy-panel-stat">
          <span class="etchspy-stat-label">Rating</span>
          <span class="etchspy-stat-value">${ratingHtml}</span>
        </div>
        <div class="etchspy-panel-stat">
          <span class="etchspy-stat-label">Favorites</span>
          <span class="etchspy-stat-value">${fmt(favorites)}</span>
        </div>
        <div class="etchspy-panel-stat">
          <span class="etchspy-stat-label">Hearts/mo</span>
          <span class="etchspy-stat-value">${
            favorites > 0 && listing_age_months > 0
              ? '~' + fmt(favorites / listing_age_months)
              : '—'
          }</span>
        </div>
        <div class="etchspy-panel-stat">
          <span class="etchspy-stat-label">Price</span>
          <span class="etchspy-stat-value">${fmtPrice(price)}</span>
        </div>
      </div>

      <div class="etchspy-panel-tags">
        <span class="etchspy-stat-label">Tags</span>
        <div class="etchspy-tags-list">${tagsHtml}</div>
      </div>

      <div class="etchspy-panel-footer">
        <button id="etchspy-save-listing-btn" class="etchspy-btn-primary">
          + Add to Research List
        </button>
        <button id="etchspy-export-listing-btn" class="etchspy-btn-secondary">
          Export CSV
        </button>
      </div>

      <div class="etchspy-panel-disclaimer">
        Estimates based on industry-average review rates. Actual sales may vary.
      </div>
    `;

    // Wire up buttons
    panel.querySelector('#etchspy-panel-close').addEventListener('click', () => panel.remove());

    panel.querySelector('#etchspy-save-listing-btn').addEventListener('click', async () => {
      const btn = panel.querySelector('#etchspy-save-listing-btn');
      const added = await Storage.addToResearchList(data);
      btn.textContent = added ? '✓ Saved!' : '✓ Already saved';
      btn.disabled = true;
    });

    panel.querySelector('#etchspy-export-listing-btn').addEventListener('click', () => {
      CsvExport.download([data]);
    });

    return panel;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════════════════════════════════════════

  async function run() {
    try {
      // Respect trial / license gate
      const licensed = await License.isLicensed();
      if (!licensed) {
        const count = await Storage.getAnalysisCount();
        if (count >= 3) return; // silently skip on listing page if trial exhausted
        // Don't increment trial count on listing pages — only search pages use the counter
      }

      // ── Try JSON-LD first (most accurate), fall back to DOM scraping ────────
      const jsonLd = extractFromJsonLd();

      const review_count       = jsonLd?.review_count      ?? extractReviewCount();
      const listing_age_months = jsonLd?.listing_age_months ?? estimateListingAge(review_count);
      const price              = jsonLd?.price              ?? extractPrice();
      const rating             = jsonLd?.rating             ?? extractRating();
      const reviewRate         = detectReviewRate();

      const { est_total_sales, est_monthly_sales, est_monthly_revenue } =
        calculateEstimates(review_count, price, listing_age_months, reviewRate);

      const listingUrl = window.location.href.split('?')[0]; // strip query params

      const data = {
        title:               extractTitle(),
        price,
        review_count,
        rating,
        favorites:           extractFavorites(),
        shop_name:           extractShopName(),
        shop_url:            extractShopUrl(),
        listing_age_months,
        tags:                extractTags(),
        is_bestseller:       extractIsBestseller(),
        listing_url:         listingUrl,
        est_total_sales,
        est_monthly_sales,
        est_monthly_revenue,
      };

      console.log('[EtchSpy listing] data:', data);

      // Remove any existing panel
      document.getElementById('etchspy-listing-panel')?.remove();

      const panel = renderPanel(data);

      // Insert after the best available anchor element
      const anchor = queryOne(document, SEL.insertAfter);
      if (anchor) {
        anchor.insertAdjacentElement('afterend', panel);
      } else {
        // Last resort: prepend to main or body
        (document.querySelector('main') || document.body).prepend(panel);
      }

    } catch (err) {
      console.error('[EtchSpy listing] Error:', err);
    }
  }

  // Run after DOM is fully settled; use a small timeout because Etsy may still
  // be hydrating its React components when document_idle fires.
  if (document.readyState === 'complete') {
    setTimeout(run, 600);
  } else {
    window.addEventListener('load', () => setTimeout(run, 600));
  }

  // Also handle Etsy SPA navigations (back/forward within a listing)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.href.includes('/listing/')) {
        document.getElementById('etchspy-listing-panel')?.remove();
        setTimeout(run, 800);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Message listener (popup can ask for listing data)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_LISTING_DATA') {
      run().then(() => sendResponse({ success: true }));
      return true;
    }
  });
}
