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

    // "(1,234 reviews)" link or span near the star rating
    reviewsText: [
      'a[href*="#reviews"]',
      '[class*="reviews-section"] a',
      'span[class*="review-count"]',
      '[data-reviews-count]',
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
    const el = queryOne(document, SEL.reviewsText);
    if (!el) return 0;
    const text = el.textContent + ' ' + (el.getAttribute('aria-label') || '');
    // Try k-number parse first (handles "7.3k reviews")
    const kMatch = text.match(/([\d.]+[kK])/);
    if (kMatch) return parseKNumber(kMatch[1]);
    const m = text.match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
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

  // Estimate listing age from page text first, then review-count tiers
  function estimateListingAge(reviewCount) {
    const bodyText    = document.body.textContent;
    const yearsMatch  = bodyText.match(/(\d+)\s+year/i);
    const monthsMatch = bodyText.match(/(\d+)\s+month/i);
    if (yearsMatch)  return parseInt(yearsMatch[1], 10) * 12;
    if (monthsMatch) return parseInt(monthsMatch[1], 10);
    // Tiered fallback
    if (reviewCount <  10)  return 3;
    if (reviewCount <  100) return 6;
    if (reviewCount < 1000) return 12;
    return 18;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTIMATES
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateEstimates(reviews, price, ageMonths) {
    const est_total_sales     = reviews / 0.04;
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

      // Collect all data
      const review_count       = extractReviewCount();
      const listing_age_months = estimateListingAge(review_count);
      const price              = extractPrice();
      const { est_total_sales, est_monthly_sales, est_monthly_revenue } =
        calculateEstimates(review_count, price, listing_age_months);

      const listingUrl = window.location.href.split('?')[0]; // strip query params

      const data = {
        title:               extractTitle(),
        price,
        review_count,
        rating:              extractRating(),
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
