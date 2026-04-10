// content_etsy_shop.js — injected on https://www.etsy.com/shop/*
// Shows a full EtchSpy shop analysis panel at the top of the shop page.
// Depends on: storage.js, license.js, csv_export.js (loaded first via manifest)
'use strict';

if (!window.__etchspy_shop_injected) {
  window.__etchspy_shop_injected = true;
  etchspyShop();
}

function etchspyShop() {

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTOR LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════

  const SEL = {
    listingCards: [
      'li[data-listing-id]',
      'div[data-listing-id]',
      '[class*="listing-card"]',
      '.wt-grid__item-xs-6',
      '[class*="shop-listing-card"]',
    ],
    title: [
      'h3',
      '[data-listing-title]',
      'a[href*="/listing/"] h3',
      'a[title]',
    ],
    price: [
      '.currency-value',
      '[class*="currency-value"]',
      '[data-currency-value]',
      'span[class*="price"]',
    ],
    reviewCount: [
      '[class*="rating-count"]',
      'span[class*="star-rating"] + span',
      '[aria-label*="reviews"]',
      'span[class*="count"]',
    ],
    listingUrl: ['a[href*="/listing/"]'],
    // Insert the panel before this element (at top of page content area)
    insertAnchor: [
      '[class*="shop-home-wider-items"]',
      '[data-shop-home-query]',
      '[class*="shop-listings-section"]',
      '[class*="shop-home-section"]',
      'main section',
      'main > div:first-of-type',
      'main',
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DOM HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function queryOne(ctx, sels) {
    for (const s of sels) {
      try { const el = ctx.querySelector(s); if (el) return el; } catch (_) {}
    }
    return null;
  }

  function queryAll(ctx, sels) {
    for (const s of sels) {
      try { const els = ctx.querySelectorAll(s); if (els.length) return Array.from(els); } catch (_) {}
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function parseKNumber(text) {
    if (!text) return 0;
    const kMatch = text.match(/([\d.]+)\s*[kK]/);
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
    const plain = text.match(/[\d,]+/);
    return plain ? parseInt(plain[0].replace(/,/g, ''), 10) : 0;
  }

  function safeNum(n)    { const v = Math.round(n || 0); return isFinite(v) ? v : 0; }

  function _detectReviewRate(title) {
    const t = (title || '').toLowerCase();
    if (/\bdigital\b|\bdownload\b|\bprintable\b|\bsvg\b|\bpdf\b|\binstant\b/.test(t)) return 0.025;
    if (/personali|custom|\bengraved\b|wedding|memorial|sympathy|baby\s*shower|engagement|bespoke/.test(t)) return 0.085;
    return 0.04;
  }
  function fmt(n)        { return safeNum(n).toLocaleString(); }
  function fmtD(n)       { return n > 0 ? '$' + safeNum(n).toLocaleString() : '—'; }
  function fmtPrice(n)   { return n > 0 ? '$' + Number(n).toFixed(2) : '—'; }
  function esc(s)        { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function trunc(s, max) { return s && s.length > max ? s.slice(0, max) + '…' : (s || ''); }

  function revenueColor(rev) {
    if (!rev || rev <= 0) return '#9CA3AF';
    if (rev >= 1000) return '#10B981';
    if (rev >= 200)  return '#F59E0B';
    return '#D1D5DB';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHOP NAME EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════════

  function extractShopName() {
    // Most reliable: pull from URL path /shop/ShopName
    const m = location.pathname.match(/\/shop\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    const el = document.querySelector('h1');
    return el ? el.textContent.trim() : 'This Shop';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LISTING EXTRACTION (per card)
  // ═══════════════════════════════════════════════════════════════════════════

  function extractListingFromCard(card) {
    const titleEl = queryOne(card, SEL.title);
    const title = titleEl
      ? titleEl.textContent.trim().replace(/\s+/g, ' ')
      : (queryOne(card, SEL.listingUrl)?.title || 'Unknown');

    const priceEl = queryOne(card, SEL.price);
    let price = 0;
    if (priceEl) {
      const priceCtx = priceEl.closest('[class*="price"]') || priceEl;
      const matches = priceCtx.textContent.match(/[\d,]+\.?\d*/g);
      if (matches) {
        const vals = matches.map(m => parseFloat(m.replace(/,/g, ''))).filter(n => n > 0);
        price = vals.length ? Math.min(...vals) : 0;
      }
    }

    const reviewEl = queryOne(card, SEL.reviewCount);
    let review_count = 0;
    if (reviewEl) {
      review_count = parseKNumber(reviewEl.textContent);
    }
    if (!review_count) {
      const allText = card.textContent;
      const patterns = [
        /\(([\d.,]+[kK]?)\)/,
        /([\d.,]+[kK]?)\s+reviews?/i,
        /([\d.,]+[kK]?)\s+ratings?/i,
      ];
      for (const re of patterns) {
        const m = allText.match(re);
        if (m) { review_count = parseKNumber(m[1]); break; }
      }
    }

    const urlEl = queryOne(card, SEL.listingUrl);
    let listing_url = '';
    if (urlEl) {
      try { const u = new URL(urlEl.href); listing_url = u.origin + u.pathname; }
      catch (_) { listing_url = urlEl.href || ''; }
    }

    // Estimate age via review-count tiers (body text scanning is unreliable
    // due to Etsy renewal dates appearing as "X months ago" on card text)
    let listing_age_months;
    if      (review_count <    10) listing_age_months =  3;
    else if (review_count <   100) listing_age_months =  8;
    else if (review_count <   500) listing_age_months = 14;
    else if (review_count <  2000) listing_age_months = 24;
    else if (review_count <  8000) listing_age_months = 36;
    else if (review_count < 20000) listing_age_months = 54;
    else                           listing_age_months = 72;

    const reviewRate          = _detectReviewRate(title);
    const est_total_sales     = review_count / reviewRate;
    const est_monthly_sales   = listing_age_months > 0 ? est_total_sales / listing_age_months : 0;
    const est_monthly_revenue = est_monthly_sales * price;

    return {
      title, price, review_count, listing_url, listing_age_months,
      est_total_sales, est_monthly_sales, est_monthly_revenue,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PANEL RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  function renderShopPanel(shopName, listings) {
    const totalRevenue = listings.reduce((s, l) => s + (l.est_monthly_revenue || 0), 0);
    const totalSales   = listings.reduce((s, l) => s + (l.est_monthly_sales   || 0), 0);
    const priced       = listings.filter(l => l.price > 0);
    const avgPrice     = priced.length > 0
      ? priced.reduce((s, l) => s + l.price, 0) / priced.length
      : 0;

    // Sort by revenue descending
    const sorted = [...listings].sort((a, b) => (b.est_monthly_revenue || 0) - (a.est_monthly_revenue || 0));

    const rowsHtml = sorted.map((l) => `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
        <td style="padding:6px 8px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <a href="${esc(l.listing_url)}" target="_blank"
             style="color:#e5e7eb;text-decoration:none;font-size:11px"
             title="${esc(l.title)}">${esc(trunc(l.title, 50))}</a>
        </td>
        <td style="text-align:right;padding:6px 8px;font-size:11px;white-space:nowrap;color:#e5e7eb">${fmtPrice(l.price)}</td>
        <td style="text-align:right;padding:6px 8px;font-size:11px;white-space:nowrap;color:#e5e7eb">
          ${l.review_count > 0 ? '~' + fmt(l.est_monthly_sales) : '<span style="color:#6B7280">New</span>'}
        </td>
        <td style="text-align:right;padding:6px 8px;font-size:11px;white-space:nowrap;font-weight:600;color:${revenueColor(l.est_monthly_revenue)}">
          ${l.review_count > 0 ? fmtD(l.est_monthly_revenue) : '—'}
        </td>
        <td style="text-align:right;padding:6px 8px;font-size:11px;color:#9CA3AF">${fmt(l.review_count)}</td>
      </tr>
    `).join('');

    const panel = document.createElement('div');
    panel.id = 'etchspy-shop-panel';
    panel.setAttribute('data-etchspy', 'true');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">📊</span>
          <div>
            <div style="font-size:15px;font-weight:700;color:#F56400">EtchSpy — Shop Analysis</div>
            <div style="font-size:12px;color:#9CA3AF;margin-top:2px">${esc(shopName)}</div>
          </div>
        </div>
        <button id="etchspy-shop-close-btn"
          style="background:none;border:none;color:#6B7280;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px;border-radius:6px;transition:color 0.15s"
          title="Close">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
        <div style="background:rgba(255,255,255,0.07);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#F56400">${listings.length}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:0.4px">Listings found</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#10B981">${fmtD(totalRevenue)}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:0.4px">Est. Rev/mo</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#e5e7eb">~${fmt(totalSales)}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:0.4px">Est. Sales/mo</div>
        </div>
        <div style="background:rgba(255,255,255,0.07);border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:700;color:#e5e7eb">${fmtPrice(avgPrice)}</div>
          <div style="font-size:10px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:0.4px">Avg. Price</div>
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.05);border-radius:8px;overflow:auto;max-height:300px">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.12)">
              <th style="text-align:left;padding:8px 8px;font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;position:sticky;top:0;background:#0f0f23">Title</th>
              <th style="text-align:right;padding:8px 8px;font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;position:sticky;top:0;background:#0f0f23">Price</th>
              <th style="text-align:right;padding:8px 8px;font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;position:sticky;top:0;background:#0f0f23">Sales/mo</th>
              <th style="text-align:right;padding:8px 8px;font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;position:sticky;top:0;background:#0f0f23">Rev/mo</th>
              <th style="text-align:right;padding:8px 8px;font-size:10px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;position:sticky;top:0;background:#0f0f23">Reviews</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px">
        <button id="etchspy-shop-export-btn"
          style="background:#F56400;color:#fff;border:none;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;transition:opacity 0.15s">
          ⬇ Export CSV
        </button>
        <div style="font-size:10px;color:#4B5563;font-style:italic">
          Estimates based on industry-average review rates.
        </div>
      </div>
    `;

    // Apply dark panel base style
    panel.style.cssText = `
      background: #0f0f23;
      color: #e5e7eb;
      border-radius: 12px;
      padding: 20px 20px 18px;
      margin: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 30px rgba(0,0,0,0.3);
      position: relative;
      z-index: 1000;
    `;

    panel.querySelector('#etchspy-shop-close-btn').addEventListener('click', () => panel.remove());

    panel.querySelector('#etchspy-shop-export-btn').addEventListener('click', () => {
      const exportData = listings.map((l) => ({ ...l, shop_name: shopName }));
      CsvExport.download(exportData, `etchspy-shop-${shopName}.csv`);
    });

    return panel;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════════════════════════════════════════

  async function run() {
    try {
      // License / trial gate
      const licensed = await License.isLicensed();
      if (!licensed) {
        const count = await Storage.getAnalysisCount();
        if (count >= 3) return;
      }

      // Wait for Etsy to finish rendering
      await new Promise((r) => setTimeout(r, 1200));

      // Remove any stale panel
      document.getElementById('etchspy-shop-panel')?.remove();

      const shopName = extractShopName();
      const cards    = queryAll(document, SEL.listingCards);

      if (cards.length === 0) {
        console.log('[EtchSpy shop] No listing cards found on this shop page.');
        return;
      }

      console.log(`[EtchSpy shop] Found ${cards.length} listings for shop: ${shopName}`);

      const seenUrls = new Set();
      const listings = [];

      for (const card of cards) {
        if (card.getAttribute('data-etchspy')) continue;
        try {
          const l = extractListingFromCard(card);
          if (l.listing_url && seenUrls.has(l.listing_url)) continue;
          if (l.listing_url) seenUrls.add(l.listing_url);
          listings.push(l);
        } catch (err) {
          console.warn('[EtchSpy shop] Error processing card:', err);
        }
      }

      if (listings.length === 0) return;

      const panel = renderShopPanel(shopName, listings);

      // Insert before the first listings section, or prepend to main
      const anchor = queryOne(document, SEL.insertAnchor);
      if (anchor) {
        anchor.insertAdjacentElement('beforebegin', panel);
      } else {
        (document.querySelector('main') || document.body).prepend(panel);
      }

    } catch (err) {
      console.error('[EtchSpy shop] Error:', err);
    }
  }

  // ── Initial run ─────────────────────────────────────────────────────────────
  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run);
  }

  // ── SPA navigation (shop owner switching tabs within their shop) ────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (location.href.includes('/shop/')) {
        document.getElementById('etchspy-shop-panel')?.remove();
        setTimeout(run, 1400);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
