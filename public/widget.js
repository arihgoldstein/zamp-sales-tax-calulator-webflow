/*
 * Zamp Sales Tax Calculator — embeddable widget.
 *
 * One script, every location page. Drop a mount element on the page and the same file
 * configures itself from its data-* attributes (populated from the Webflow CMS):
 *
 *   <div data-zamp-calc
 *        data-city="Los Angeles" data-state="CA" data-zip="90012"
 *        data-line1="200 N Spring St"
 *        data-api="/sales-tax/api/quote"></div>
 *   <script src="/sales-tax/widget.js" defer></script>
 *
 * The widget asks the proxy for the effective RATE (one call per category+ZIP, cached),
 * then computes tax locally as the visitor types the amount. The Zamp key never ships
 * to the browser — only your own /sales-tax/api/quote endpoint is ever called.
 */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'general', label: 'General goods' },
    { id: 'clothing', label: 'Clothing & apparel' },
    { id: 'groceries', label: 'Groceries (food for home)' },
    { id: 'prepared-food', label: 'Prepared food / restaurant' },
    { id: 'candy', label: 'Candy' },
    { id: 'digital', label: 'Digital products' },
    { id: 'saas', label: 'Software (SaaS)' },
    { id: 'services', label: 'Professional services' }
  ];

  var STYLE_ID = 'zsc-styles';
  var CSS =
    '.zsc{all:initial;display:block;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;max-width:560px;box-sizing:border-box}' +
    '.zsc *,.zsc *::before,.zsc *::after{box-sizing:border-box}' +
    '.zsc-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 1px 3px rgba(15,23,42,.06)}' +
    '.zsc-h{font-size:18px;font-weight:650;margin:0 0 2px;letter-spacing:-.01em}' +
    '.zsc-sub{font-size:13px;color:#64748b;margin:0 0 18px}' +
    '.zsc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '.zsc-field{display:flex;flex-direction:column;gap:6px}' +
    '.zsc-field.zsc-full{grid-column:1 / -1}' +
    '.zsc-label{font-size:12px;font-weight:600;color:#475569}' +
    '.zsc-input,.zsc-select{font:inherit;font-size:15px;color:#0f172a;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;width:100%;height:42px;appearance:none}' +
    '.zsc-input:focus,.zsc-select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}' +
    '.zsc-amtwrap{position:relative}' +
    '.zsc-amtwrap .zsc-dollar{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:15px}' +
    '.zsc-amtwrap .zsc-input{padding-left:24px}' +
    '.zsc-select{background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath fill=\'%2394a3b8\' d=\'M6 8 0 0h12z\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}' +
    '.zsc-zip{display:flex;align-items:flex-end;gap:8px}' +
    '.zsc-zip .zsc-field{flex:0 0 120px}' +
    '.zsc-hint{font-size:12px;color:#94a3b8;padding-bottom:11px}' +
    '.zsc-result{margin-top:18px;border-top:1px solid #eef2f7;padding-top:18px}' +
    '.zsc-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}' +
    '.zsc-taxlbl{font-size:13px;color:#64748b}' +
    '.zsc-tax{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1}' +
    '.zsc-total{font-size:13px;color:#475569;margin-top:4px}' +
    '.zsc-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px}' +
    '.zsc-badge.tax{background:#eef2ff;color:#4338ca}' +
    '.zsc-badge.exempt{background:#ecfdf5;color:#047857}' +
    '.zsc-break{margin-top:14px;border:1px solid #eef2f7;border-radius:10px;overflow:hidden}' +
    '.zsc-break-row{display:flex;justify-content:space-between;font-size:13px;padding:8px 12px}' +
    '.zsc-break-row+.zsc-break-row{border-top:1px solid #f1f5f9}' +
    '.zsc-break-row.tot{background:#f8fafc;font-weight:650}' +
    '.zsc-break-row .zsc-jname{color:#475569}' +
    '.zsc-break-row .zsc-jrate{font-variant-numeric:tabular-nums;color:#0f172a}' +
    '.zsc-note{font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-top:12px}' +
    '.zsc-disc{font-size:11px;color:#94a3b8;margin-top:14px;line-height:1.5}' +
    '.zsc-err{font-size:13px;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-top:14px}' +
    '.zsc-skeleton{color:#cbd5e1}' +
    '@media(max-width:480px){.zsc-grid{grid-template-columns:1fr}}';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function pct(n) { return (n * 100).toFixed(2).replace(/\.00$/, '') + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

  function mount(node) {
    var cfg = {
      city: node.getAttribute('data-city') || '',
      state: (node.getAttribute('data-state') || '').toUpperCase(),
      zip: node.getAttribute('data-zip') || '',
      line1: node.getAttribute('data-line1') || '',
      api: node.getAttribute('data-api') || '/sales-tax/api/quote'
    };

    var locName = cfg.city ? cfg.city + ', ' + cfg.state : cfg.state;
    var optionsHtml = CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.label) + '</option>';
    }).join('');

    var root = el(
      '<div class="zsc"><div class="zsc-card">' +
        '<p class="zsc-h">Sales tax calculator' + (locName ? ' — ' + esc(locName) : '') + '</p>' +
        '<p class="zsc-sub">Estimate the sales tax on a purchase' + (cfg.zip ? ' in ZIP ' + esc(cfg.zip) : '') + '.</p>' +
        '<div class="zsc-grid">' +
          '<div class="zsc-field"><label class="zsc-label" for="zsc-amt">Item price</label>' +
            '<div class="zsc-amtwrap"><span class="zsc-dollar">$</span>' +
            '<input class="zsc-input" id="zsc-amt" type="number" inputmode="decimal" min="0" step="0.01" value="100" /></div></div>' +
          '<div class="zsc-field"><label class="zsc-label" for="zsc-cat">Category</label>' +
            '<select class="zsc-select" id="zsc-cat">' + optionsHtml + '</select></div>' +
          '<div class="zsc-field zsc-full"><label class="zsc-label" for="zsc-zip">ZIP code</label>' +
            '<div class="zsc-zip"><div class="zsc-field"><input class="zsc-input" id="zsc-zip" type="text" inputmode="numeric" maxlength="5" value="' + esc(cfg.zip) + '" /></div>' +
            '<span class="zsc-hint">Change the ZIP for an exact local rate.</span></div></div>' +
        '</div>' +
        '<div class="zsc-result" id="zsc-result"></div>' +
        '<p class="zsc-disc">Estimates only, for general information — not tax advice. Rates are sourced live from Zamp and can vary by exact address. Powered by Zamp.</p>' +
      '</div></div>'
    );

    node.innerHTML = '';
    node.appendChild(root);

    var amtEl = root.querySelector('#zsc-amt');
    var catEl = root.querySelector('#zsc-cat');
    var zipEl = root.querySelector('#zsc-zip');
    var resultEl = root.querySelector('#zsc-result');

    // Every result is a real Zamp calc for the exact amount; we just memoize by exact
    // input so re-typing a seen value is instant. No client-side rate extrapolation.
    var cache = {};        // cat:zip:cents -> { taxable, tax, effectiveRate, jurisdictions, note }
    var debounce = null;   // input debounce timer
    var reqId = 0;         // guards against out-of-order responses
    var lastNote = null;   // category note for the active selection

    function amountVal() { var a = parseFloat(amtEl.value); return (isNaN(a) || a < 0) ? 0 : a; }
    function keyFor() { return catEl.value + ':' + (zipEl.value || '').trim() + ':' + Math.round(amountVal() * 100); }

    function renderError(msg) { resultEl.innerHTML = '<div class="zsc-err">' + esc(msg) + '</div>'; }
    function setBusy(on) { resultEl.style.opacity = on ? '0.55' : '1'; }

    function paint(d) {
      setBusy(false);
      var amount = amountVal();
      var tax = d.taxable ? d.tax : 0;
      var total = amount + tax;

      var badge = d.taxable
        ? '<span class="zsc-badge tax">Taxable · ' + pct(d.effectiveRate) + '</span>'
        : '<span class="zsc-badge exempt">Exempt here</span>';

      var html =
        '<div class="zsc-row"><div>' +
          '<div class="zsc-taxlbl">Estimated sales tax</div>' +
          '<div class="zsc-tax">' + usd.format(tax) + '</div>' +
          '<div class="zsc-total">Total with tax: <strong>' + usd.format(total) + '</strong></div>' +
        '</div>' + badge + '</div>';

      if (d.taxable && d.jurisdictions && d.jurisdictions.length) {
        html += '<div class="zsc-break">';
        d.jurisdictions.forEach(function (j) {
          html += '<div class="zsc-break-row"><span class="zsc-jname">' + esc(j.name) + '</span><span class="zsc-jrate">' + pct(j.rate) + '</span></div>';
        });
        html += '<div class="zsc-break-row tot"><span class="zsc-jname">Effective rate at ' + usd.format(amount) + '</span><span class="zsc-jrate">' + pct(d.effectiveRate) + '</span></div></div>';
      }
      if (lastNote) html += '<div class="zsc-note">' + esc(lastNote) + '</div>';
      resultEl.innerHTML = html;
    }

    function update() {
      var zip = (zipEl.value || '').trim();
      if (!/^\d{5}$/.test(zip)) { renderError('Enter a valid 5-digit ZIP code.'); return; }

      var k = keyFor();
      if (cache[k]) { lastNote = cache[k].note; paint(cache[k]); return; }

      setBusy(true);
      var myId = ++reqId;
      var amount = amountVal();
      fetch(cfg.api, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxCode: catEl.value, zip: zip, state: cfg.state, city: cfg.city, line1: cfg.line1, amount: amount })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          if (myId !== reqId) return; // a newer request superseded this one
          if (!res.ok) {
            if (res.status === 429) renderError('High demand right now — please try again in a moment.');
            else renderError(res.d && res.d.error ? res.d.error : 'Could not calculate tax.');
            return;
          }
          var entry = { taxable: res.d.taxable, tax: res.d.tax, effectiveRate: res.d.effectiveRate, jurisdictions: res.d.jurisdictions, note: res.d.note };
          cache[k] = entry;
          lastNote = entry.note;
          paint(entry);
        })
        .catch(function () { if (myId === reqId) renderError('Network error — please try again.'); });
    }

    function debounced() { clearTimeout(debounce); debounce = setTimeout(update, 400); }

    amtEl.addEventListener('input', debounced);
    catEl.addEventListener('change', update);
    zipEl.addEventListener('input', debounced);

    update();
  }

  function init() {
    injectStyles();
    var nodes = document.querySelectorAll('[data-zamp-calc]');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].getAttribute('data-zsc-ready')) {
        nodes[i].setAttribute('data-zsc-ready', '1');
        mount(nodes[i]);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
