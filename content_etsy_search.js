// content_etsy_search.js — injected on https://www.etsy.com/search*
// Depends on: storage.js, license.js, csv_export.js (loaded first via manifest)
'use strict';

// Guard against double-injection on SPA navigations that re-run content scripts
if (window.__etchspy_search_injected) {
  // Already running — the MutationObserver inside will handle new results
} else {
  window.__etchspy_search_injected = true;
  etchspySearch();
}

function etchspySearch() {

  const FREE_TRIAL_LIMIT = 3;

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTOR LIBRARY
  // Each array is tried in order; first match wins. The winning selector is
  // logged to the console so you know exactly what to fix if Etsy updates.
  // ═══════════════════════════════════════════════════════════════════════════

  const SEL = {
    // The outer card/list-item for each search result
    cards: [
      '[data-search-results-lg-card]',
      '[data-search-results-card]',
      'li[data-listing-id]',
      'div[data-listing-id]',
      '#search-results li',
      'ul[data-search-results] > li',
      '.wt-grid__item-xs-6',
    ],

    // Product title inside a card
    title: [
      'h3',
      '[data-listing-title]',
      '[class*="listing-card__title"]',
      'p[class*="title"]',
      'a[href*="/listing/"] h3',
      'a[title]',
    ],

    // Price — handles single and range formats
    price: [
      '.currency-value',
      '[class*="currency-value"]',
      'span[class*="price-value"]',
      '[data-currency-value]',
      'p[class*="price"] span',
      'span[class*="price"]',
    ],

    // Review / rating count
    reviewCount: [
      '[class*="rating-count"]',
      'span[class*="star-rating"] + span',
      '[aria-label*="reviews"]',
      '[title*="reviews"]',
      'span[class*="count"]',
    ],

    // Favorites / wishlisted count
    favorites: [
      '[class*="wishlist-count"]',
      '[aria-label*="favorites"]',
      '[title*="favorites"]',
      'span[class*="favorite"]',
    ],

    // Shop name
    shopName: [
      '[class*="shop-name"]',
      'a[href*="/shop/"]',
      'p[class*="shop"]',
      '[data-shop-name]',
    ],

    // Direct link to the listing
    listingUrl: [
      'a[href*="/listing/"]',
    ],

    // Sponsored / ad label — Etsy marks these with "Ad by" text or a data attribute
    adLabel: [
      '[data-is-ad="true"]',
      '[class*="ad-label"]',
      '[class*="sponsored"]',
      '[aria-label*="sponsored" i]',
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTOR HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function queryAll(context, selectors) {
    for (const sel of selectors) {
      try {
        const els = context.querySelectorAll(sel);
        if (els.length > 0) {
          console.log(`[EtchSpy] selector hit: "${sel}"`);
          return Array.from(els);
        }
      } catch (_) { /* invalid selector — skip */ }
    }
    return [];
  }

  function queryOne(context, selectors) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el) return el;
      } catch (_) { /* skip */ }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  function extractPrice(card) {
    const el = queryOne(card, SEL.price);
    if (!el) return 0;

    // Grab all text content; Etsy may render "From $12.00" or "$12.00 – $45.00"
    const text = el.closest('[class*="price"]')
      ? el.closest('[class*="price"]').textContent
      : el.textContent;

    // Extract all numeric values and use the smallest (handles ranges)
    const matches = text.match(/[\d,]+\.?\d*/g);
    if (!matches || matches.length === 0) return 0;

    const values = matches.map((m) => parseFloat(m.replace(/,/g, ''))).filter((n) => n > 0);
    return values.length > 0 ? Math.min(...values) : 0;
  }

  // ── Safe number formatter (guards against NaN / undefined) ──────────────
  function safeNum(n) { const v = Math.round(n || 0); return isFinite(v) ? v : 0; }

  // Revenue colour for mini-panel text
  function revenueColorStyle(rev) {
    if (!rev || rev <= 0) return 'color:rgba(255,255,255,0.4)';
    if (rev >= 1000) return 'color:#4ADE80';
    if (rev >= 200)  return 'color:#FCD34D';
    return 'color:rgba(255,255,255,0.65)';
  }

  // Detect sponsored / ad listings
  function isAdListing(card) {
    if (card.dataset.isAd === 'true') return true;
    if (queryOne(card, SEL.adLabel)) return true;
    // "Ad by ShopName" is Etsy's standard text label for sponsored results
    return /\bAd\s+by\b/i.test(card.textContent);
  }

  // Parses numbers like "7.3k" → 7300, "1.2K" → 1200, "1,234" → 1234
  function parseKNumber(text) {
    if (!text) return 0;
    const kMatch = text.match(/([\d.]+)\s*[kK]/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const plain = text.match(/[\d,]+/);
    return plain ? parseInt(plain[0].replace(/,/g, ''), 10) : 0;
  }

  function extractReviewCount(card) {
    // Approach 1: explicit selector
    const el = queryOne(card, SEL.reviewCount);
    if (el) {
      const count = parseKNumber(el.textContent);
      if (count > 0) return count;
    }

    // Approach 2: scan card text for known patterns including "k" suffix
    const allText = card.textContent;
    const patterns = [
      /\(([\d.,]+[kK]?)\)/,              // (7.3k) or (1,234)
      /([\d.,]+[kK]?)\s+reviews?/i,      // 7.3k reviews
      /([\d.,]+[kK]?)\s+ratings?/i,      // 1.2k ratings
    ];
    for (const re of patterns) {
      const m = allText.match(re);
      if (m) return parseKNumber(m[1]);
    }

    return 0;
  }

  function extractFavorites(card) {
    const el = queryOne(card, SEL.favorites);
    if (!el) return 0;
    const m = el.textContent.match(/[\d,]+/);
    return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0;
  }

  function extractShopName(card) {
    const el = queryOne(card, SEL.shopName);
    if (!el) return '';
    // "by ShopName" pattern common on Etsy cards
    const text = el.textContent.trim().replace(/^by\s+/i, '');
    return text;
  }

  function extractListingUrl(card) {
    const el = queryOne(card, SEL.listingUrl);
    if (!el) return '';
    // Strip tracking params for a clean URL
    try {
      const url = new URL(el.href);
      // Keep only the path — etsy.com/listing/123456/title
      return url.origin + url.pathname;
    } catch (_) {
      return el.href;
    }
  }

  function extractTitle(card) {
    const el = queryOne(card, SEL.title);
    if (el) return el.textContent.trim().replace(/\s+/g, ' ');

    // Fallback: use the link's title attribute
    const link = queryOne(card, SEL.listingUrl);
    if (link && link.title) return link.title.trim();

    return 'Unknown title';
  }

  // Estimate listing age from visible "X ago" text, falling back to review-count tiers
  function estimateListingAge(card, reviewCount) {
    const text = card.textContent;
    const yearsMatch  = text.match(/(\d+)\s+year/i);
    const monthsMatch = text.match(/(\d+)\s+month/i);
    if (yearsMatch)  return parseInt(yearsMatch[1], 10) * 12;
    if (monthsMatch) return parseInt(monthsMatch[1], 10);
    // Tiered fallback based on review count
    if (reviewCount <  10)  return 3;
    if (reviewCount <  100) return 6;
    if (reviewCount < 1000) return 12;
    return 18;
  }

  function extractListingData(card) {
    const review_count = extractReviewCount(card);
    return {
      title:               extractTitle(card),
      price:               extractPrice(card),
      review_count,
      favorites:           extractFavorites(card),
      shop_name:           extractShopName(card),
      listing_url:         extractListingUrl(card),
      listing_age_months:  estimateListingAge(card, review_count),
      is_ad:               isAdListing(card),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SALES ESTIMATES
  // Review rates vary significantly by category:
  //   Digital/downloads  → ~2.5%  (low friction, less emotional investment)
  //   Personalized/custom → ~8.5% (high emotional investment, buyers review more)
  //   Default physical    → ~4.0%
  // ═══════════════════════════════════════════════════════════════════════════

  function detectListingReviewRate(title) {
    const t = (title || '').toLowerCase();
    if (/\bdigital\b|\bdownload\b|\bprintable\b|\bsvg\b|\bpdf\b|\binstant\b/.test(t)) return 0.025;
    if (/personali|custom|\bengraved\b|wedding|memorial|sympathy|baby\s*shower|engagement|bespoke/.test(t)) return 0.085;
    return 0.04;
  }

  function calculateEstimates(data) {
    const reviews    = data.review_count || 0;
    const price      = data.price || 0;
    const age        = data.listing_age_months || 12;
    const reviewRate = detectListingReviewRate(data.title);

    const est_total_sales     = reviews / reviewRate;
    const est_monthly_sales   = age > 0 ? est_total_sales / age : 0;
    const est_monthly_revenue = est_monthly_sales * price;

    return { ...data, est_total_sales, est_monthly_sales, est_monthly_revenue };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BADGE + SAVE-BUTTON INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function injectBadge(card, listing) {
    // Make the image wrapper the badge's positioning anchor
    const img = card.querySelector('img');
    if (!img) return;

    const imgWrap = img.parentElement;
    if (imgWrap && getComputedStyle(imgWrap).position === 'static') {
      imgWrap.style.position = 'relative';
    }

    // Stats badge
    const badge = document.createElement('div');
    badge.className = 'etchspy-badge';
    badge.setAttribute('data-etchspy', 'true');

    if (listing.review_count === 0) {
      badge.innerHTML = '📦 <span>New listing</span>';
    } else {
      const sales   = safeNum(listing.est_monthly_sales);
      const revenue = safeNum(listing.est_monthly_revenue);
      const trendHtml = listing.trend === 'up'
        ? ' <span class="etchspy-trend-up">↑</span>'
        : listing.trend === 'down'
        ? ' <span class="etchspy-trend-down">↓</span>'
        : '';
      badge.innerHTML =
        `<span>📦 ~${sales.toLocaleString()}/mo</span>` +
        `<span style="margin-left:6px">💰 ~$${revenue.toLocaleString()}/mo</span>` +
        trendHtml;
    }

    // Mark sponsored listings prominently
    if (listing.is_ad) {
      const adTag = document.createElement('span');
      adTag.className = 'etchspy-ad-tag';
      adTag.setAttribute('data-etchspy', 'true');
      adTag.textContent = 'Ad';
      card.appendChild(adTag);
    }

    if (imgWrap) {
      imgWrap.appendChild(badge);
    }

    // "+" save button — sits at top-right of card
    const saveBtn = document.createElement('button');
    saveBtn.className = 'etchspy-save-btn';
    saveBtn.setAttribute('data-etchspy', 'true');
    saveBtn.title = 'Save to EtchSpy Research List';
    saveBtn.textContent = '+';

    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const added = await Storage.addToResearchList(listing);
      saveBtn.textContent = '✓';
      saveBtn.classList.add('saved');
      saveBtn.title = added ? 'Saved!' : 'Already in list';
    });

    card.style.position = 'relative';
    card.appendChild(saveBtn);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FLOATING ACTION BUTTON (export)
  // ═══════════════════════════════════════════════════════════════════════════

  let pageListings = [];

  function upsertFAB() {
    let fab = document.getElementById('etchspy-fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'etchspy-fab';
      fab.setAttribute('data-etchspy', 'true');
      fab.addEventListener('click', () => {
        if (pageListings.length === 0) return;
        CsvExport.download(pageListings);
      });
      document.body.appendChild(fab);
    }
    fab.textContent = `📊 Export ${pageListings.length} result${pageListings.length !== 1 ? 's' : ''} to CSV`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOP MINI-PANEL (appears when user clicks a shop name on a search page)
  // ═══════════════════════════════════════════════════════════════════════════

  function showShopMiniPanel(shopName, shopUrl, listings, clientX, clientY) {
    document.getElementById('etchspy-shop-mini')?.remove();

    const totalRevenue = listings.reduce((s, l) => s + (l.est_monthly_revenue || 0), 0);
    const priced       = listings.filter((l) => l.price > 0);
    const avgPrice     = priced.length > 0
      ? priced.reduce((s, l) => s + l.price, 0) / priced.length
      : 0;

    const escName = shopName.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const panel = document.createElement('div');
    panel.id    = 'etchspy-shop-mini';
    panel.setAttribute('data-etchspy', 'true');

    panel.innerHTML = `
      <div class="etchspy-shop-mini-header">
        <span>📊 ${escName}</span>
        <button class="etchspy-shop-mini-close" title="Close">✕</button>
      </div>
      <div class="etchspy-shop-mini-stats">
        <div class="etchspy-shop-mini-stat">
          <span class="etchspy-shop-mini-val">${listings.length}</span>
          <span class="etchspy-shop-mini-label">on page</span>
        </div>
        <div class="etchspy-shop-mini-stat">
          <span class="etchspy-shop-mini-val" style="${revenueColorStyle(totalRevenue)}">
            ~$${safeNum(totalRevenue).toLocaleString()}
          </span>
          <span class="etchspy-shop-mini-label">est. rev/mo</span>
        </div>
        <div class="etchspy-shop-mini-stat">
          <span class="etchspy-shop-mini-val">$${Number(avgPrice).toFixed(2)}</span>
          <span class="etchspy-shop-mini-label">avg price</span>
        </div>
      </div>
      <a href="${shopUrl}" class="etchspy-shop-mini-visit" id="etchspy-mini-visit-link">
        View Shop Analytics →
      </a>
    `;

    // Position near cursor, clamp to viewport
    const PW = 265, PH = 175;
    let left = clientX + 14;
    let top  = clientY + 14;
    if (left + PW > window.innerWidth  - 8) left = clientX - PW - 14;
    if (top  + PH > window.innerHeight - 8) top  = clientY - PH - 14;
    panel.style.left = Math.max(8, left) + 'px';
    panel.style.top  = Math.max(8, top)  + 'px';

    panel.querySelector('.etchspy-shop-mini-close').addEventListener('click', () => panel.remove());
    panel.querySelector('#etchspy-mini-visit-link').addEventListener('click', (e) => {
      e.preventDefault();
      panel.remove();
      window.open(shopUrl, '_blank');
    });

    // Auto-dismiss after 9 seconds
    setTimeout(() => document.getElementById('etchspy-shop-mini')?.remove(), 9000);

    document.body.appendChild(panel);
  }

  // Delegated click listener — intercept shop-name link clicks inside cards
  document.addEventListener('click', (e) => {
    const shopLink = e.target.closest('a[href*="/shop/"]');

    // Dismiss panel on any click that isn't the panel itself
    if (!shopLink) {
      if (!e.target.closest('#etchspy-shop-mini')) {
        document.getElementById('etchspy-shop-mini')?.remove();
      }
      return;
    }

    // Don't intercept links that are already inside our own UI
    if (shopLink.closest('[data-etchspy]')) return;

    // Must be inside a listing card
    const inCard = shopLink.closest('[data-listing-id], [class*="listing-card"], .wt-grid__item-xs-6, li');
    if (!inCard) return;

    const shopMatch = shopLink.href.match(/\/shop\/([^/?#]+)/);
    if (!shopMatch) return;
    const rawName = shopMatch[1];

    // Match against shop names we already extracted (normalize spaces)
    const shopListings = pageListings.filter((l) =>
      l.shop_name &&
      l.shop_name.toLowerCase().replace(/\s/g, '') === rawName.toLowerCase()
    );

    if (shopListings.length > 0) {
      e.preventDefault();
      showShopMiniPanel(rawName, shopLink.href, shopListings, e.clientX, e.clientY);
    }
  }, true /* capture — fires before Etsy's own handlers */);

  // ═══════════════════════════════════════════════════════════════════════════
  // BANNERS
  // ═══════════════════════════════════════════════════════════════════════════

  function removeBanner() {
    const existing = document.getElementById('etchspy-banner');
    if (existing) existing.remove();
  }

  function showBanner(html, type = 'info') {
    removeBanner();
    const banner = document.createElement('div');
    banner.id = 'etchspy-banner';
    banner.className = `etchspy-banner etchspy-banner--${type}`;
    banner.setAttribute('data-etchspy', 'true');
    banner.innerHTML = html + `<button class="etchspy-banner-close" onclick="this.parentElement.remove()">✕</button>`;
    document.body.insertAdjacentElement('afterbegin', banner);
  }

  function showErrorBanner() {
    showBanner(
      `<strong>EtchSpy</strong> couldn't read this page — Etsy may have updated their layout. ` +
      `<a href="mailto:med.badri86@gmail.com?subject=EtchSpy+Selector+Issue&body=URL:+${encodeURIComponent(location.href)}" ` +
      `style="color:inherit;text-decoration:underline">Report Issue</a>`,
      'error'
    );
  }

  function showUpgradeBanner() {
    showBanner(
      `<strong>EtchSpy</strong> — Free trial ended. ` +
      `<button onclick="chrome.runtime.sendMessage({type:'OPEN_GUMROAD'})" ` +
      `style="background:#F56400;color:#fff;border:none;border-radius:4px;padding:3px 10px;cursor:pointer;margin-left:8px">` +
      `🔒 Unlock — Buy on Gumroad</button>`,
      'upgrade'
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN ANALYSIS RUNNER
  // ═══════════════════════════════════════════════════════════════════════════

  let analysisRunning = false;

  async function analyzePage() {
    if (analysisRunning) return;
    analysisRunning = true;

    try {
      // ── License / trial gate ─────────────────────────────────────────────
      const licensed = await License.isLicensed();
      if (!licensed) {
        const count = await Storage.getAnalysisCount();
        if (count >= FREE_TRIAL_LIMIT) {
          showUpgradeBanner();
          return;
        }
        await Storage.incrementAnalysisCount();
      }

      removeBanner();

      // Remove badges and buttons from the previous run
      document.querySelectorAll('[data-etchspy="true"]').forEach((el) => el.remove());

      // ── Find cards ────────────────────────────────────────────────────────
      const cards = queryAll(document, SEL.cards);

      if (cards.length === 0) {
        console.warn('[EtchSpy] No listing cards found. Etsy may have updated their layout.');
        showErrorBanner();
        return;
      }

      console.log(`[EtchSpy] Found ${cards.length} listing cards`);
      pageListings = [];

      const seenUrls = new Set();

      // ── Pass 1: collect data (no badge injection yet) ────────────────────
      const cardDataPairs = [];
      for (const card of cards) {
        if (card.getAttribute('data-etchspy')) continue;
        try {
          const raw     = extractListingData(card);
          const listing = calculateEstimates(raw);
          if (listing.listing_url && seenUrls.has(listing.listing_url)) continue;
          if (listing.listing_url) seenUrls.add(listing.listing_url);
          cardDataPairs.push({ card, listing });
        } catch (err) {
          console.warn('[EtchSpy] Error processing card:', err);
        }
      }

      // ── Trend baseline: average monthly sales of organic listings with reviews ─
      const velocities = cardDataPairs
        .filter(({ listing }) => !listing.is_ad && listing.review_count > 0)
        .map(({ listing }) => listing.est_monthly_sales);
      const avgMonthly = velocities.length > 0
        ? velocities.reduce((s, v) => s + v, 0) / velocities.length
        : 0;

      // ── Pass 2: assign trend + inject badges ─────────────────────────────
      for (const { card, listing } of cardDataPairs) {
        if (!listing.is_ad && listing.review_count > 0 && avgMonthly > 0) {
          const ratio = listing.est_monthly_sales / avgMonthly;
          listing.trend = ratio >= 1.25 ? 'up' : ratio <= 0.75 ? 'down' : 'neutral';
        } else {
          listing.trend = 'neutral';
        }
        pageListings.push(listing);
        injectBadge(card, listing);
      }

      // Save to storage so popup can read without messaging
      await Storage.setPageResults(pageListings);

      upsertFAB();

    } catch (err) {
      console.error('[EtchSpy] Analysis failed:', err);
    } finally {
      analysisRunning = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MUTATION OBSERVER — Etsy SPA / pagination / infinite scroll
  // ═══════════════════════════════════════════════════════════════════════════

  let debounceTimer = null;

  // Find the most specific stable container to observe; fall back to body
  const observerRoot =
    document.querySelector('#search-results') ||
    document.querySelector('[data-search-results]') ||
    document.body;

  const observer = new MutationObserver((mutations) => {
    // Ignore mutations that are only EtchSpy's own injected elements
    const relevant = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (n) => n.nodeType === 1 && !n.getAttribute?.('data-etchspy')
      )
    );
    if (!relevant) return;

    clearTimeout(debounceTimer);
    // 900ms debounce: wait for Etsy to finish rendering before we scan
    debounceTimer = setTimeout(analyzePage, 900);
  });

  observer.observe(observerRoot, { childList: true, subtree: true });

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGE LISTENER — popup requests live data
  // ═══════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_RESULTS') {
      sendResponse({ results: pageListings });
      return true;
    }
    if (message.type === 'EXPORT_PAGE_CSV') {
      CsvExport.download(pageListings);
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'REFRESH_ANALYSIS') {
      analyzePage().then(() => sendResponse({ success: true, count: pageListings.length }));
      return true; // async
    }
  });

  // ── Initial run ──────────────────────────────────────────────────────────
  analyzePage();
}
