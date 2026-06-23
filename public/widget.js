/*
 * Zamp Sales Tax Calculator — embeddable widget.
 *
 * One script, every location page. Drop a mount element on the page and the same file
 * configures itself from its data-* attributes (populated from the Webflow CMS):
 *
 *   <div data-zamp-calc
 *        data-city="Los Angeles" data-state="CA" data-zip="90012"
 *        data-line1="200 N Spring St"
 *        data-api="/tools/sales-tax-calculator/api/quote"></div>
 *   <script src="/tools/sales-tax-calculator/widget.js" defer></script>
 *
 * Submit-driven: the visitor enters a price + category and presses Calculate; each click
 * is one real Zamp calculation for the exact amount (proxied so the API key stays server
 * side). Location is fixed by the page (from the CMS) — no ZIP entry. Styled to the Zamp
 * brand; on zamp.com the Season fonts load natively from the host page.
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
  var CSS = [
    '.zsc{--green:#183e3d;--green2:#1b595a;--beige:#f6f5f3;--lbeige:#fafaf9;--dbeige:#e6e1da;--vdbeige:#c8bfb1;',
    '--mint:#afecdb;--orange:#ff8232;--yellow:#ffec72;--ink:#141414;--neutral:#838383;--white:#fff;',
    '--j1:#afecdb;--j2:#74cdba;--j3:#e2f6ef;--ease:cubic-bezier(.215,.61,.355,1);',
    "--head:Seasonmix,'Helvetica Neue',Helvetica,Arial,sans-serif;--body:Seasonsans,'Helvetica Neue',Helvetica,Arial,sans-serif;",
    'all:initial;display:block;font-family:var(--body);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased;text-align:left}',
    '.zsc *,.zsc *::before,.zsc *::after{box-sizing:border-box}',
    '.zsc-grid{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,9fr);gap:20px;align-items:stretch}',
    '.zsc-panel{background:var(--white);border:1px solid var(--dbeige)}',
    '.zsc-pad{padding:28px}',
    '.zsc-kicker{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--neutral);margin:0 0 22px}',
    '.zsc-loc{border:1px solid var(--dbeige);background:var(--lbeige);padding:13px 15px;margin-bottom:22px;display:flex;align-items:flex-start;gap:11px}',
    '.zsc-pin{width:9px;height:9px;background:var(--green);flex:0 0 auto;margin-top:4px}',
    '.zsc-loc-t{font-size:12px;color:var(--neutral)}',
    '.zsc-loc-v{font-size:15px;color:var(--ink)}',
    '.zsc-field{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}',
    '.zsc-label{font-size:13px;font-weight:500;color:var(--ink)}',
    '.zsc-input,.zsc-select{font-family:var(--body);font-size:16px;color:var(--ink);background:var(--white);border:1px solid var(--vdbeige);border-radius:0;padding:13px 15px;width:100%;height:50px;appearance:none;transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}',
    '.zsc-input:focus-visible,.zsc-select:focus-visible{outline:none;border-color:var(--green);box-shadow:0 0 0 3px rgba(24,62,61,.14)}',
    '.zsc-amt{position:relative}',
    '.zsc-amt .zsc-sig{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--neutral)}',
    '.zsc-amt .zsc-input{padding-left:30px;font-variant-numeric:tabular-nums}',
    ".zsc-select{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23838383' d='M6 8 0 0h12z'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 15px center}",
    '.zsc-btn{font-family:var(--body);font-size:16px;font-weight:500;letter-spacing:.02em;color:var(--white);background:var(--ink);border:1px solid var(--ink);border-radius:0;padding:14px 18px;width:100%;cursor:pointer;transition:background-color .3s var(--ease),border-color .3s var(--ease)}',
    '.zsc-btn:hover{background:var(--green);border-color:var(--green)}',
    '.zsc-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(24,62,61,.28)}',
    '.zsc-hint{font-size:12.5px;color:var(--orange);margin:12px 0 0;min-height:1em;opacity:0;transition:opacity .2s}',
    '.zsc-hint.show{opacity:1}',
    '.zsc-result{background:var(--green);border-color:var(--green);color:var(--white);display:flex;flex-direction:column}',
    '.zsc-rpad{padding:28px;display:flex;flex-direction:column;height:100%;transition:opacity .2s var(--ease)}',
    '.zsc-rpad.stale{opacity:.42}',
    '.zsc-tlabel{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#7fa6a0;margin:0 0 8px}',
    '.zsc-tax{font-family:var(--head);font-size:clamp(2.6rem,7vw,3.6rem);font-weight:500;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;margin:0}',
    '.zsc-sub{color:#bcd4cf;font-size:14.5px;margin:12px 0 0;font-variant-numeric:tabular-nums}',
    '.zsc-sub strong{color:var(--white);font-weight:500}',
    '.zsc-chip{align-self:flex-start;margin-top:18px;font-size:13px;font-weight:500;padding:6px 13px;border-radius:999px}',
    '.zsc-chip.tax{background:var(--mint);color:var(--green)}',
    '.zsc-chip.exempt{background:var(--yellow);color:#5a4a00}',
    '.zsc-prompt{color:#bcd4cf;font-size:15px;line-height:1.5;margin:14px 0 0}',
    '.zsc-stack{margin-top:28px}',
    '.zsc-bar{display:flex;height:14px;background:rgba(255,255,255,.12);overflow:hidden}',
    '.zsc-seg{height:100%;transition:width .55s var(--ease)}',
    '.zsc-legend{margin-top:20px;border-top:1px solid rgba(255,255,255,.16)}',
    '.zsc-lrow{display:grid;grid-template-columns:13px 1fr auto;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:14.5px}',
    '.zsc-lk{width:11px;height:11px}',
    '.zsc-ln{color:#cfe0dc}',
    '.zsc-lv{font-variant-numeric:tabular-nums;color:var(--white)}',
    '.zsc-lrow.tot{border-bottom:none;padding-bottom:0}',
    '.zsc-lrow.tot .zsc-ln{color:var(--white)}',
    '.zsc-lrow.tot .zsc-lv{color:var(--yellow);font-size:16px}',
    '.zsc-note{margin-top:auto;padding-top:20px;color:#9fbdb7;font-size:12.5px;line-height:1.5}',
    '.zsc-note.reason{color:#eaf6f2;font-size:15px;line-height:1.55;border-top:1px solid rgba(255,255,255,.16);margin-top:24px;padding-top:20px}',
    '.zsc-err{color:var(--yellow);font-size:14px;line-height:1.5;margin:14px 0 0}',
    '.zsc-disc{font-size:11.5px;color:var(--neutral);line-height:1.55;margin:16px 0 0;max-width:80ch}',
    '@media(max-width:640px){.zsc-grid{grid-template-columns:1fr}}',
    '@media(prefers-reduced-motion:reduce){.zsc-seg,.zsc-rpad,.zsc-hint{transition:none}}'
  ].join('');

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function pct(n) { return (n * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

  function mount(node) {
    var cfg = {
      city: node.getAttribute('data-city') || '',
      state: (node.getAttribute('data-state') || '').toUpperCase(),
      zip: node.getAttribute('data-zip') || '',
      line1: node.getAttribute('data-line1') || '',
      api: node.getAttribute('data-api') || '/tools/sales-tax-calculator/api/quote'
    };
    var locText = (cfg.city ? cfg.city + ', ' + cfg.state : cfg.state) + (cfg.zip ? ' · ' + cfg.zip : '');
    var options = CATEGORIES.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('');

    var root = el(
      '<div class="zsc"><div class="zsc-grid">' +
        '<div class="zsc-panel"><div class="zsc-pad">' +
          '<p class="zsc-kicker">Calculate</p>' +
          '<div class="zsc-loc"><span class="zsc-pin"></span><span><span class="zsc-loc-t">Location</span><br><span class="zsc-loc-v">' + esc(locText) + '</span></span></div>' +
          '<div class="zsc-field"><label class="zsc-label" for="zsc-amt">Item price</label>' +
            '<div class="zsc-amt"><span class="zsc-sig">$</span><input class="zsc-input" id="zsc-amt" type="number" inputmode="decimal" min="0" step="0.01" value="100"></div></div>' +
          '<div class="zsc-field"><label class="zsc-label" for="zsc-cat">What are you buying?</label>' +
            '<select class="zsc-select" id="zsc-cat">' + options + '</select></div>' +
          '<button class="zsc-btn" id="zsc-go" type="button">Calculate tax</button>' +
          '<p class="zsc-hint" id="zsc-hint">Inputs changed — calculate to update.</p>' +
        '</div></div>' +
        '<div class="zsc-panel zsc-result"><div class="zsc-rpad" id="zsc-rpad"></div></div>' +
      '</div>' +
      '<p class="zsc-disc">Estimates for general information only — not tax advice. Rates can vary by exact address within a ZIP code. Sales tax data powered by Zamp.</p>' +
      '</div>'
    );

    node.innerHTML = '';
    node.appendChild(root);

    var amtEl = root.querySelector('#zsc-amt');
    var catEl = root.querySelector('#zsc-cat');
    var goEl = root.querySelector('#zsc-go');
    var hintEl = root.querySelector('#zsc-hint');
    var pad = root.querySelector('#zsc-rpad');

    var cache = {};       // cat:cents -> response
    var reqId = 0;

    function amountVal() { var a = parseFloat(amtEl.value); return (isNaN(a) || a < 0) ? 0 : a; }
    function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

    function showPrompt() {
      pad.classList.remove('stale');
      pad.innerHTML =
        '<p class="zsc-tlabel">Estimated sales tax</p>' +
        '<p class="zsc-tax">$0.00</p>' +
        '<p class="zsc-prompt">Enter a price and choose a category, then press <strong style="color:#fff;font-weight:500">Calculate</strong>.</p>';
    }
    function showError(msg) {
      pad.classList.remove('stale');
      pad.innerHTML = '<p class="zsc-tlabel">Estimated sales tax</p><p class="zsc-err">' + esc(msg) + '</p>';
    }

    function render(d, animate) {
      pad.classList.remove('stale');
      hintEl.classList.remove('show');
      var amount = amountVal();

      if (d.taxable) {
        var html =
          '<p class="zsc-tlabel">Estimated sales tax</p>' +
          '<p class="zsc-tax">' + usd.format(d.tax) + '</p>' +
          '<p class="zsc-sub">on ' + usd.format(amount) + ' &middot; total <strong>' + usd.format(amount + d.tax) + '</strong></p>' +
          '<span class="zsc-chip tax">Taxable · ' + pct(d.effectiveRate) + '</span>';

        var js = d.jurisdictions || [];
        var palette = ['var(--j1)', 'var(--j2)', 'var(--j3)', 'var(--mint)'];
        var sumRates = js.reduce(function (s, j) { return s + j.rate; }, 0) || 1;
        if (js.length) {
          html += '<div class="zsc-stack"><div class="zsc-bar" id="zsc-bar">';
          js.forEach(function (j, i) {
            var w = (j.rate / sumRates * 100);
            html += '<div class="zsc-seg" data-w="' + w + '%" style="background:' + palette[i % palette.length] + ';width:' + (animate ? 0 : w) + '%"></div>';
          });
          html += '</div><div class="zsc-legend">';
          js.forEach(function (j, i) {
            html += '<div class="zsc-lrow"><span class="zsc-lk" style="background:' + palette[i % palette.length] + '"></span><span class="zsc-ln">' + esc(j.name) + '</span><span class="zsc-lv">' + pct(j.rate) + '</span></div>';
          });
          html += '<div class="zsc-lrow tot"><span></span><span class="zsc-ln">Effective rate</span><span class="zsc-lv">' + pct(d.effectiveRate) + '</span></div></div></div>';
        }
        html += '<p class="zsc-note">Calculated by Zamp for your exact amount — local caps and exemptions included.</p>';
        pad.innerHTML = html;

        if (animate && js.length) {
          var segs = pad.querySelectorAll('.zsc-seg');
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            segs.forEach(function (s) { s.style.width = s.getAttribute('data-w'); });
          }); });
        }
      } else {
        pad.innerHTML =
          '<p class="zsc-tlabel">Estimated sales tax</p>' +
          '<p class="zsc-tax">' + usd.format(0) + '</p>' +
          '<p class="zsc-sub">on ' + usd.format(amount) + ' &middot; total <strong>' + usd.format(amount) + '</strong></p>' +
          '<span class="zsc-chip exempt">Exempt' + (cfg.state ? ' in ' + esc(cfg.state) : '') + '</span>' +
          (d.note ? '<p class="zsc-note reason">' + esc(d.note) + '</p>' : '');
      }
    }

    function calculate() {
      var cat = catEl.value;
      var amount = amountVal();
      var k = cat + ':' + Math.round(amount * 100);
      if (cache[k]) { render(cache[k], !reduceMotion()); return; }

      pad.classList.add('stale');
      var myId = ++reqId;
      fetch(cfg.api, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxCode: cat, zip: cfg.zip, state: cfg.state, city: cfg.city, line1: cfg.line1, amount: amount })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          if (myId !== reqId) return;
          if (!res.ok) {
            showError(res.status === 429 ? 'High demand right now — please try again in a moment.' : (res.d && res.d.error ? res.d.error : 'Could not calculate tax.'));
            return;
          }
          cache[k] = res.d;
          render(res.d, !reduceMotion());
        })
        .catch(function () { if (myId === reqId) showError('Network error — please try again.'); });
    }

    function markStale() { pad.classList.add('stale'); hintEl.classList.add('show'); }

    amtEl.addEventListener('input', markStale);
    catEl.addEventListener('change', markStale);
    goEl.addEventListener('click', calculate);

    // Populate with the page default on load. This request (general goods at the page's
    // ZIP, $100) is the same one the data pipeline pre-warms, so it's a cache hit — no
    // extra Zamp call per pageview.
    calculate();
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
