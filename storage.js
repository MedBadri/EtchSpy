// storage.js — chrome.storage.local helpers
// Loaded before content scripts and popup scripts so all can use Storage.*
'use strict';

const Storage = {
  // ── Low-level wrappers ────────────────────────────────────────────────────

  get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },

  set(data) {
    return new Promise((resolve) => chrome.storage.local.set(data, resolve));
  },

  // ── Research list ─────────────────────────────────────────────────────────

  async getResearchList() {
    const data = await this.get(['research_list']);
    return data.research_list || [];
  },

  /**
   * Add a listing to the research list.
   * @returns {boolean} true if added, false if duplicate (matched by listing_url)
   */
  async addToResearchList(item) {
    const list = await this.getResearchList();
    const alreadySaved = list.some((i) => i.listing_url === item.listing_url);
    if (!alreadySaved) {
      list.unshift({ ...item, saved_at: new Date().toISOString() });
      await this.set({ research_list: list });
    }
    return !alreadySaved;
  },

  async removeFromResearchList(listingUrl) {
    const list = await this.getResearchList();
    await this.set({ research_list: list.filter((i) => i.listing_url !== listingUrl) });
  },

  async clearResearchList() {
    await this.set({ research_list: [] });
  },

  // ── License ───────────────────────────────────────────────────────────────

  async getLicenseStatus() {
    const data = await this.get(['license_key', 'license_valid']);
    return { key: data.license_key || null, valid: data.license_valid === true };
  },

  async setLicense(key, valid) {
    await this.set({ license_key: key, license_valid: valid });
  },

  // ── Free trial counter ────────────────────────────────────────────────────

  async getAnalysisCount() {
    const data = await this.get(['analysis_count']);
    return data.analysis_count || 0;
  },

  async incrementAnalysisCount() {
    const count = await this.getAnalysisCount();
    const next = count + 1;
    await this.set({ analysis_count: next });
    return next;
  },

  // ── Current-page results (written by content script, read by popup) ───────

  async setPageResults(results) {
    await this.set({ page_results: results, page_results_ts: Date.now() });
  },

  async getPageResults() {
    const data = await this.get(['page_results', 'page_results_ts']);
    return {
      results: data.page_results || [],
      timestamp: data.page_results_ts || 0,
    };
  },
};
