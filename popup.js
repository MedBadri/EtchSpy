// popup.js — EtchSpy popup controller
// Depends on: storage.js, license.js, csv_export.js (loaded first in popup.html)
'use strict';

const FREE_TRIAL_LIMIT = 3;

// Sort state — tracks active column + direction per table
const sortState = {
  research: { col: 'est_monthly_revenue', dir: 'desc' },
  current:  { col: 'est_monthly_revenue', dir: 'desc' },
};

// Column definitions for each table
const RESEARCH_COLS = [
  { key: 'title',               label: 'Title',         type: 'str' },
  { key: 'price',               label: 'Price',         type: 'num' },
  { key: 'est_monthly_sales',   label: 'Est. Sales/mo', type: 'num' },
  { key: 'est_monthly_revenue', label: 'Est. Rev/mo',   type: 'num' },
  { key: 'shop_name',           label: 'Shop',          type: 'str' },
];
const CURRENT_COLS = [
  { key: 'title',               label: 'Title',         type: 'str' },
  { key: 'price',               label: 'Price',         type: 'num' },
  { key: 'est_monthly_sales',   label: 'Est. Sales/mo', type: 'num' },
  { key: 'est_monthly_revenue', label: 'Est. Rev/mo',   type: 'num' },
  { key: 'review_count',        label: 'Reviews',       type: 'num' },
];

// Generic sort — handles both string and numeric columns
function sortListings(list, col, dir) {
  return [...list].sort((a, b) => {
    let va = a[col] ?? (col === 'title' || col === 'shop_name' ? '' : 0);
    let vb = b[col] ?? (col === 'title' || col === 'shop_name' ? '' : 0);
    if (typeof va === 'string') {
      va = va.toLowerCase(); vb = (vb || '').toLowerCase();
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return dir === 'asc' ? (va - vb) : (vb - va);
  });
}

// Build a sortable thead row and wire click handlers
function buildSortableThead(tableId, cols, stateKey, renderFn, dataRef) {
  const tr = document.querySelector(`#${tableId} thead tr`);
  if (!tr) return;
  tr.innerHTML = '';
  const { col: activeCol, dir } = sortState[stateKey];

  for (const colDef of cols) {
    const th = document.createElement('th');
    th.className = 'th-sortable' + (colDef.key === activeCol ? ' th-active' : '');
    const arrow = colDef.key === activeCol ? (dir === 'desc' ? ' ▼' : ' ▲') : '';
    th.textContent = colDef.label + arrow;
    th.addEventListener('click', () => {
      if (sortState[stateKey].col === colDef.key) {
        sortState[stateKey].dir = sortState[stateKey].dir === 'desc' ? 'asc' : 'desc';
      } else {
        sortState[stateKey].col = colDef.key;
        // Strings default to A→Z; numbers default to highest first
        sortState[stateKey].dir = colDef.type === 'str' ? 'asc' : 'desc';
      }
      renderFn(dataRef);
    });
    tr.appendChild(th);
  }
  // Empty action column
  tr.appendChild(document.createElement('th'));
}
const GUMROAD_URL   = 'https://medbadria.gumroad.com/l/fkmhmq';
const SUPPORT_EMAIL = 'med.badri86@gmail.com';

// ═══════════════════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  wireExternalLinks();

  const { licensed, trialCount } = await getAuthState();

  if (!licensed && trialCount >= FREE_TRIAL_LIMIT) {
    showLicenseGate();
    return;
  }

  showMainContent(licensed, trialCount);

  await Promise.all([
    loadResearchList(),
    loadCurrentPage(),
    loadSettingsTab(),
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH STATE
// ═══════════════════════════════════════════════════════════════════════════════

async function getAuthState() {
  const [{ valid: licensed }, trialCount] = await Promise.all([
    Storage.getLicenseStatus(),
    Storage.getAnalysisCount(),
  ]);
  return { licensed, trialCount };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GATE / MAIN CONTENT VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

function showLicenseGate() {
  document.getElementById('license-gate').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');
  wireGateButtons();
}

function showMainContent(licensed, trialCount) {
  document.getElementById('license-gate').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');

  // Trial banner
  const banner = document.getElementById('trial-banner');
  if (!licensed) {
    const remaining = Math.max(0, FREE_TRIAL_LIMIT - trialCount);
    document.getElementById('trial-remaining-text').textContent =
      `Free trial: ${remaining} analysis${remaining !== 1 ? 'es' : ''} remaining`;
    banner.classList.remove('hidden');
    document.getElementById('trial-buy-btn').addEventListener('click', openGumroad);
  } else {
    banner.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════════════════════════

function initTabs() {
  const tabBtns  = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b)  => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(btn.dataset.tab).classList.add('active');

      // Reload data when switching to Current Page tab
      if (btn.dataset.tab === 'tab-current') loadCurrentPage();
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESEARCH LIST TAB
// ═══════════════════════════════════════════════════════════════════════════════

async function loadResearchList() {
  const list = await Storage.getResearchList();
  renderResearchTable(list);

  document.getElementById('export-research-btn').addEventListener('click', async () => {
    const items = await Storage.getResearchList();
    if (items.length === 0) return;
    CsvExport.download(items);
  });

  document.getElementById('clear-research-btn').addEventListener('click', async () => {
    if (!confirm('Clear all saved products?')) return;
    await Storage.clearResearchList();
    renderResearchTable([]);
  });
}

function renderResearchTable(list) {
  const empty = document.getElementById('research-empty');
  const wrap  = document.getElementById('research-table-wrap');
  const tbody = document.getElementById('research-tbody');

  // Deduplicate by URL (safety net for any legacy duplicates in storage)
  const seen = new Set();
  list = list.filter((item) => {
    if (seen.has(item.listing_url)) return false;
    seen.add(item.listing_url);
    return true;
  });

  if (list.length === 0) {
    empty.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  wrap.classList.remove('hidden');

  const { col, dir } = sortState.research;
  const sorted = sortListings(list, col, dir);

  buildSortableThead('research-table', RESEARCH_COLS, 'research', renderResearchTable, list);

  tbody.innerHTML = '';
  for (const item of sorted) {
    const adBadge = item.is_ad ? ' <span class="ad-badge">Ad</span>' : '';
    const salesCell = item.review_count === 0 ? '<span class="dim-cell">New</span>'
      : fmtSales(item.est_monthly_sales);
    const revCell = item.review_count === 0 ? '<span class="dim-cell">—</span>'
      : fmtRevenue(item.est_monthly_revenue);

    const tr = document.createElement('tr');
    if (item.is_ad) tr.classList.add('row-ad');
    tr.innerHTML = `
      <td class="title-cell">
        <a href="${escHtml(item.listing_url)}" target="_blank" title="${escHtml(item.title)}">
          ${escHtml(truncate(item.title, 38))}
        </a>${adBadge}
      </td>
      <td class="num-cell">${fmtPrice(item.price)}</td>
      <td class="num-cell">${salesCell}</td>
      <td class="num-cell">${revCell}</td>
      <td class="title-cell">${escHtml(truncate(item.shop_name || '—', 18))}</td>
      <td class="action-cell">
        <button class="delete-btn" data-url="${escHtml(item.listing_url)}" title="Remove">🗑</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Wire delete buttons
  tbody.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await Storage.removeFromResearchList(btn.dataset.url);
      const updated = await Storage.getResearchList();
      renderResearchTable(updated);
    });
  });

}

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENT PAGE TAB
// ═══════════════════════════════════════════════════════════════════════════════

async function loadCurrentPage() {
  const notEtsy    = document.getElementById('current-not-etsy');
  const noResults  = document.getElementById('current-no-results');
  const tableWrap  = document.getElementById('current-table-wrap');
  const countBar   = document.getElementById('current-result-count');

  // Hide everything while loading
  [notEtsy, noResults, tableWrap].forEach((el) => el.classList.add('hidden'));

  // Get the active tab
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {
    notEtsy.classList.remove('hidden');
    return;
  }

  const isSearchPage = tab.url && tab.url.includes('etsy.com/search');

  if (!isSearchPage) {
    notEtsy.classList.remove('hidden');
    // Wire up export/refresh anyway (no-op state)
    wireCurrentPageButtons([], tab);
    return;
  }

  // Try to get live results from the content script
  let results = [];
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_RESULTS' });
    if (response && Array.isArray(response.results)) {
      results = response.results;
    }
  } catch (_) {
    // Content script not ready yet — fall back to storage cache
    const cached = await Storage.getPageResults();
    results = cached.results;
  }

  if (results.length === 0) {
    noResults.classList.remove('hidden');
    wireCurrentPageButtons([], tab);
    return;
  }

  tableWrap.classList.remove('hidden');

  // Non-ad listings only for all stats/calculations
  const organicResults = results.filter((r) => !r.is_ad);

  // ── Count bar ──────────────────────────────────────────────────────────
  const adCount = results.length - organicResults.length;
  const adNote  = adCount > 0 ? ` (${adCount} ad${adCount !== 1 ? 's' : ''} excluded from stats)` : '';
  countBar.textContent = `${results.length} listing${results.length !== 1 ? 's' : ''} analysed${adNote}`;

  // ── Price range + avg (organic listings with a real price) ────────────
  const priceStats = document.getElementById('current-price-stats');
  const priced = organicResults.filter((r) => r.price > 0).map((r) => r.price);
  if (priced.length > 0) {
    const minP = Math.min(...priced);
    const maxP = Math.max(...priced);
    const avgP = priced.reduce((s, v) => s + v, 0) / priced.length;
    priceStats.textContent =
      `Price range: $${minP.toFixed(2)} – $${maxP.toFixed(2)} · Avg: $${avgP.toFixed(2)}`;
  } else {
    priceStats.textContent = '';
  }

  renderCurrentTable(results);
  wireCurrentPageButtons(results, tab);

  // ── High opportunity banner (organic listings only) ───────────────────
  const oppBanner    = document.getElementById('current-opportunity-banner');
  const highRevCount = organicResults.filter((r) => (r.est_monthly_revenue || 0) > 500).length;
  oppBanner.classList.toggle('hidden', highRevCount < 3);

  // ── Top keywords ──────────────────────────────────────────────────────
  const topTagsSection = document.getElementById('current-top-tags');
  const tagsList       = document.getElementById('current-tags-list');
  const keywords       = extractTopKeywords(organicResults, 8);

  if (keywords.length > 0) {
    topTagsSection.classList.remove('hidden');
    tagsList.innerHTML = '';
    for (const { word, count } of keywords) {
      const pill = document.createElement('button');
      pill.className = 'tag-pill';
      pill.title     = `Appears in ${count} title${count !== 1 ? 's' : ''} — click to copy`;
      pill.textContent = word;
      pill.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(word);
          pill.classList.add('tag-pill--copied');
          pill.textContent = '✓ ' + word;
          setTimeout(() => {
            pill.classList.remove('tag-pill--copied');
            pill.textContent = word;
          }, 1500);
        } catch (_) {
          // Clipboard not available — silently ignore
        }
      });
      tagsList.appendChild(pill);
    }
  } else {
    topTagsSection.classList.add('hidden');
  }
}

function renderCurrentTable(results) {
  const tbody = document.getElementById('current-tbody');

  const { col, dir } = sortState.current;
  const sorted = sortListings(results, col, dir);

  buildSortableThead('current-table', CURRENT_COLS, 'current', renderCurrentTable, results);

  tbody.innerHTML = '';
  for (const item of sorted) {
    const adBadge = item.is_ad ? ' <span class="ad-badge">Ad</span>' : '';
    const salesCell = item.review_count === 0 ? '<span class="dim-cell">New</span>'
      : fmtSales(item.est_monthly_sales);
    const revCell = item.review_count === 0 ? '<span class="dim-cell">—</span>'
      : fmtRevenue(item.est_monthly_revenue);

    const tr = document.createElement('tr');
    if (item.is_ad) tr.classList.add('row-ad');
    tr.innerHTML = `
      <td class="title-cell">
        <a href="${escHtml(item.listing_url)}" target="_blank" title="${escHtml(item.title)}">
          ${escHtml(truncate(item.title, 38))}
        </a>${adBadge}
      </td>
      <td class="num-cell">${fmtPrice(item.price)}</td>
      <td class="num-cell">${salesCell}</td>
      <td class="num-cell">${revCell}</td>
      <td class="num-cell">${fmtCount(item.review_count)}</td>
      <td class="action-cell">
        <button class="save-from-table-btn" data-url="${escHtml(item.listing_url)}" title="Save to research list">+</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Wire save buttons
  tbody.querySelectorAll('.save-from-table-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = results.find((r) => r.listing_url === btn.dataset.url);
      if (!item) return;
      await Storage.addToResearchList(item);
      btn.textContent = '✓';
      btn.classList.add('saved');
      btn.disabled = true;
      // Immediately refresh the Research List tab so it's up to date
      const updated = await Storage.getResearchList();
      renderResearchTable(updated);
    });
  });

}

function wireCurrentPageButtons(results, tab) {
  // Export
  const exportBtn = document.getElementById('export-page-btn');
  // Remove any previous listener by cloning
  const newExport = exportBtn.cloneNode(true);
  exportBtn.replaceWith(newExport);
  newExport.addEventListener('click', () => {
    if (results.length > 0) CsvExport.download(results);
  });

  // Refresh — ask the content script to re-run analysis
  const refreshBtn = document.getElementById('refresh-page-btn');
  const newRefresh = refreshBtn.cloneNode(true);
  refreshBtn.replaceWith(newRefresh);
  newRefresh.addEventListener('click', async () => {
    newRefresh.disabled = true;
    newRefresh.textContent = '↺ Refreshing…';
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_ANALYSIS' });
    } catch (_) {}
    await loadCurrentPage();
    newRefresh.disabled = false;
    newRefresh.textContent = '↺ Refresh';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════════════

async function loadSettingsTab() {
  await refreshLicenseDisplay();

  // Activate button in settings
  document.getElementById('activate-license-btn').addEventListener('click', async () => {
    await handleActivation(
      document.getElementById('license-input'),
      document.getElementById('license-feedback'),
    );
  });

  document.getElementById('license-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      await handleActivation(
        document.getElementById('license-input'),
        document.getElementById('license-feedback'),
      );
    }
  });
}

async function refreshLicenseDisplay() {
  const { key, valid } = await Storage.getLicenseStatus();
  const trialCount     = await Storage.getAnalysisCount();
  const display        = document.getElementById('license-status-display');

  display.className = 'license-status'; // reset classes
  if (valid) {
    display.classList.add('licensed');
    display.textContent = `✅ Licensed — ${maskKey(key)}`;
  } else if (trialCount < FREE_TRIAL_LIMIT) {
    display.classList.add('trial');
    const rem = FREE_TRIAL_LIMIT - trialCount;
    display.textContent = `⏳ Free Trial — ${rem} analysis${rem !== 1 ? 'es' : ''} remaining`;
  } else {
    display.classList.add('unlicensed');
    display.textContent = '❌ Trial ended — enter a license key to continue';
  }
}

async function handleActivation(inputEl, feedbackEl) {
  const key = inputEl.value.trim();
  if (!key) return;

  const isValid = await License.activate(key);

  feedbackEl.className = 'feedback ' + (isValid ? 'feedback--success' : 'feedback--error');
  feedbackEl.textContent = isValid
    ? '✅ License activated! EtchSpy is now fully unlocked.'
    : '❌ Invalid key. Please check and try again.';
  feedbackEl.classList.remove('hidden');

  if (isValid) {
    inputEl.value = '';
    await refreshLicenseDisplay();
    // If the gate was showing, switch to main content
    const { trialCount } = await getAuthState();
    showMainContent(true, trialCount);
    setTimeout(() => feedbackEl.classList.add('hidden'), 4000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GATE BUTTONS
// ═══════════════════════════════════════════════════════════════════════════════

function wireGateButtons() {
  document.getElementById('gate-buy-btn').addEventListener('click', openGumroad);

  document.getElementById('gate-activate-btn').addEventListener('click', async () => {
    await handleActivation(
      document.getElementById('gate-key-input'),
      document.getElementById('gate-feedback'),
    );
    const { licensed, trialCount } = await getAuthState();
    if (licensed) {
      showMainContent(true, trialCount);
      await Promise.all([loadResearchList(), loadCurrentPage(), loadSettingsTab()]);
    }
  });

  document.getElementById('gate-key-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') document.getElementById('gate-activate-btn').click();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTERNAL LINKS
// ═══════════════════════════════════════════════════════════════════════════════

function wireExternalLinks() {
  document.getElementById('support-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `mailto:${SUPPORT_EMAIL}?subject=EtchSpy%20Support` });
  });
  document.getElementById('gumroad-link').addEventListener('click', (e) => {
    e.preventDefault();
    openGumroad();
  });
}

function openGumroad() {
  chrome.tabs.create({ url: GUMROAD_URL });
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// Safe number helpers — never let NaN or undefined reach the UI
function safeRound(n)    { const v = Math.round(n || 0); return isFinite(v) ? v : 0; }
function fmtCount(n)     { return safeRound(n).toLocaleString(); }
function fmtRevenue(n)   { return n > 0 ? '~$' + safeRound(n).toLocaleString() : '—'; }
function fmtSales(n)     { return n > 0 ? '~' + safeRound(n).toLocaleString()  : '—'; }
function fmtPrice(n)     { return n > 0 ? '$' + Number(n).toFixed(2) : '—'; }

// Extract the top N most-frequent meaningful words from listing titles
// (used as a proxy for tags on search pages, where individual tags aren't shown)
function extractTopKeywords(listings, topN = 8) {
  const STOP = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with',
    'by','from','as','is','was','are','be','this','that','it','its',
    'my','your','our','their','new','set','gift','free','sale','best',
    'great','good','made','custom','your','our','size','inch','pack',
    'buy','get','just','also','item','shop','etsy','listing','one','two',
  ]);
  const freq = {};
  for (const item of listings) {
    if (!item.title) continue;
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w));
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

function maskKey(key) {
  if (!key || key.length < 8) return key;
  // Show first segment only: ETCH-XXXX-****-****
  const parts = key.split('-');
  if (parts.length === 4) return `${parts[0]}-${parts[1]}-****-****`;
  return key.slice(0, 9) + '****';
}
