// csv_export.js — CSV generation and browser download
'use strict';

const CsvExport = {
  HEADERS: [
    'title',
    'shop_name',
    'price',
    'est_total_sales',
    'est_monthly_sales',
    'est_monthly_revenue',
    'review_count',
    'listing_age_months',
    'listing_url',
  ],

  /**
   * Escape a single cell value per RFC 4180.
   * Wraps in double-quotes if the value contains a comma, quote, or newline.
   */
  _escape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value).replace(/\r\n|\r|\n/g, ' '); // flatten newlines in titles
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  },

  /** Build a CSV string from an array of listing objects. */
  generate(listings) {
    const rows = [this.HEADERS.join(',')];

    for (const item of listings) {
      const row = [
        this._escape(item.title),
        this._escape(item.shop_name),
        this._escape(item.price != null ? Number(item.price).toFixed(2) : ''),
        this._escape(Math.round(item.est_total_sales || 0)),
        this._escape(Math.round(item.est_monthly_sales || 0)),
        this._escape(Math.round(item.est_monthly_revenue || 0)),
        this._escape(item.review_count || 0),
        this._escape(item.listing_age_months || 12),
        this._escape(item.listing_url || ''),
      ];
      rows.push(row.join(','));
    }

    return rows.join('\r\n'); // CRLF for maximum Excel compatibility
  },

  /** Generate a filename with today's date. */
  _filename() {
    const iso = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `etchspy_research_${iso}.csv`;
  },

  /**
   * Trigger a browser download of the CSV.
   * Works in both content-script context (page document) and popup context.
   */
  download(listings, filename) {
    if (!listings || listings.length === 0) {
      console.warn('[EtchSpy] CsvExport.download called with empty listings');
      return;
    }

    const csv = this.generate(listings);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || this._filename();
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  },
};
