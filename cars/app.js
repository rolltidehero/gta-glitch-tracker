/* GTA Car Tracker UI: car value list, buyer cards and Randy's Wish List location cards with search, sort, filter and CSV export.
   Separate app from the Glitch Tracker (../). No storage APIs used. */
(function () {
  'use strict';

  var T = window.TRACKER;
  var $ = function (id) { return document.getElementById(id); };

  function rank(list) {
    return function (v) { var i = list.indexOf(v); return i === -1 ? list.length : i; };
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function svg(pathD, cls) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', cls);
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', pathD);
    s.appendChild(p);
    return s;
  }

  function badge(value, toneOverride) {
    var tone = toneOverride !== undefined ? toneOverride : (TONES[value] || '');
    return el('span', { class: 'badge' + (tone ? ' ' + tone : ''), text: value });
  }

  function sourceLink(key) {
    var s = T.sources[key];
    return el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name });
  }

  /* Turns "[[sourceKey|label]]" inside a text into real links. */
  function richText(text) {
    var frag = document.createDocumentFragment();
    var re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var s = T.sources[m[1]];
      if (s) frag.appendChild(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: m[2] }));
      else frag.appendChild(document.createTextNode(m[2]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  /* Footer: git version of this app. Read live from GitHub so the page never has to be
     rebuilt (a hash written into the files would change on every commit). */
  function renderVersion() {
    var el = $('version');
    var repo = T.meta.repo;
    if (!el || !repo) return;
    var base = 'https://github.com/' + repo;
    function fallback() {
      el.textContent = '';
      el.appendChild(document.createTextNode('Git version: not available right now. '));
      var l = document.createElement('a');
      l.href = base + '/commits'; l.target = '_blank'; l.rel = 'noopener noreferrer';
      l.textContent = 'See the commit history';
      el.appendChild(l);
    }
    fetch('https://api.github.com/repos/' + repo + '/commits?per_page=1')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var link = r.headers.get('Link') || '';
        var m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
        return r.json().then(function (list) { return { c: list[0], count: m ? m[1] : '1' }; });
      })
      .then(function (res) {
        var sha = res.c.sha;
        var when = new Date(res.c.commit.committer.date);
        var stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when) + ' CT';
        el.textContent = '';
        el.appendChild(document.createTextNode('Git version: '));
        var a = document.createElement('a');
        a.href = base + '/commit/' + sha; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.className = 'hash'; a.textContent = sha.slice(0, 7);
        el.appendChild(a);
        el.appendChild(document.createTextNode(' (commit #' + res.count + ') \u00b7 updated ' + stamp));
      })
      .catch(fallback);
  }

  function renderFootnotes() {
    var wrap = $('footnotes');
    (T.carFootnotes || []).forEach(function (p) { wrap.appendChild(el('p', null, [richText(p)])); });
  }

  function fillSelect(select, allLabel, values) {
    select.appendChild(el('option', { value: '', text: allLabel }));
    values.forEach(function (v) { select.appendChild(el('option', { value: v, text: v })); });
  }

  function download(csv, filename) {
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- Car value list ---------- */
  var cars = (T.cars || []).map(function (c, i) { c._i = i; return c; });
  var BUYER_ORDER = ['Moses', "Pay 'n' Spray", 'Randy'];
  var TRACKER_ORDER = ['None', 'Standard', 'Advanced', 'Military', 'Disputed', 'Not published'];
  var TRACKER_TONES = { None: 'pos', Standard: 'warn', Advanced: 'neg', Military: 'neg', Disputed: 'outline', 'Not published': 'outline' };
  var CONDITION_ORDER = ['Top', 'Good', 'Average', 'Poor'];
  var text = function (v) { return String(v || '').toLowerCase(); };
  /* "num: true" columns sort high to low on the first click and keep empty values last. */
  var CAR_COLUMNS = [
    { key: 'name', label: 'Vehicle', sort: function (c) { return text(c.name).replace(/^[^a-z0-9]+/, ''); } },
    { key: 'brand', label: 'Brand', sort: function (c) { return text(c.brand) || '\uffff'; } },
    { key: 'type', label: 'Class', sort: function (c) { return text(c.type) || '\uffff'; } },
    { key: 'tracker', label: 'Tracker', sort: function (c) { return rank(TRACKER_ORDER)(c.tracker); } },
    { key: 'buyer', label: 'Sells to', sort: function (c) { return c.buyers.length ? rank(BUYER_ORDER)(c.buyers[0]) : 9; } },
    { key: 'value', label: 'Sell value', num: true, sort: function (c) { return c.sortValue; } },
    { key: 'register', label: 'Cost to register', num: true, sort: function (c) { return c.registerCost; } },
    { key: 'condition', label: 'Condition scanned', sort: function (c) { return rank(CONDITION_ORDER)(c.condition); } },
    { key: 'note', label: 'Where to find it, notes and sources' },
  ];
  var CAR_COL = {};
  CAR_COLUMNS.forEach(function (c) { CAR_COL[c.key] = c; });
  var carState = { q: '', buyer: '', tracker: '', sortKey: 'value', sortDir: -1 };
  var carEls = {
    rows: $('car-rows'), head: $('car-head'), count: $('car-count'), empty: $('car-empty'),
    q: $('car-q'), buyer: $('car-buyer'), tracker: $('car-tracker'), sort: $('car-sort'),
  };
  var money = function (n) { return '$' + Number(n).toLocaleString('en-US'); };

  function carHaystack(c) {
    if (!c._hay) c._hay = [c.name, c.brand, c.type, c.era, c.tracker, c.buyerLabel, c.valueText, c.condition, c.note, c.wishList ? 'wish list randy' : ''].join(' ').toLowerCase();
    return c._hay;
  }

  function visibleCars() {
    var terms = carState.q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = cars.filter(function (c) {
      if (carState.buyer === 'none' ? c.buyers.length > 0 : (carState.buyer && c.buyers.indexOf(carState.buyer) === -1)) return false;
      if (carState.tracker && c.tracker !== carState.tracker) return false;
      var hay = carHaystack(c);
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
    var get = CAR_COL[carState.sortKey].sort;
    list.sort(function (a, b) {
      var x = get(a), y = get(b);
      var xNone = x === null || x === undefined, yNone = y === null || y === undefined;
      if (xNone || yNone) { if (xNone && yNone) return a._i - b._i; return xNone ? 1 : -1; }
      if (x < y) return -carState.sortDir;
      if (x > y) return carState.sortDir;
      return a._i - b._i;
    });
    return list;
  }

  function carRow(c) {
    var name = el('td', { class: 'cell-name car-name' }, [el('span', { text: c.name })]);
    if (c.wishList) name.appendChild(el('span', { class: 'badge pos', text: 'Wish List' }));
    if (c.wish) {
      /* Jumps from the table row to this car's location card further down. */
      var go = el('button', { type: 'button', class: 'link-btn', 'data-wish': wishId(c), text: 'Location card' });
      go.addEventListener('click', function () { showWishCard(c); });
      name.appendChild(go);
    }
    var buyers = el('td', { class: 'cell-buyers', 'data-label': 'Sells to' });
    if (c.buyers.length) c.buyers.forEach(function (b) { buyers.appendChild(badge(b, '')); });
    else buyers.appendChild(el('span', { class: 'muted', text: c.buyerLabel }));
    var note = el('td', { class: 'cell-note', 'data-label': 'Where to find it, notes and sources' });
    if (c.note) note.appendChild(el('p', { text: c.note }));
    var src = el('p', { class: 'car-src' });
    c.sources.forEach(function (k, i) {
      if (i) src.appendChild(document.createTextNode(', '));
      src.appendChild(sourceLink(k));
    });
    note.appendChild(src);
    var dash = function (v) { return v || 'Not listed'; };
    return el('tr', { class: 'row' }, [
      name,
      el('td', { class: 'cell-cat', 'data-label': 'Brand', text: dash(c.brand) }),
      el('td', { class: 'cell-cat', 'data-label': 'Class', text: dash(c.type) }),
      el('td', { 'data-label': 'Tracker' }, [badge(c.tracker, TRACKER_TONES[c.tracker] || '')]),
      buyers,
      el('td', { class: 'cell-money' + (c.sortValue === null ? ' none' : ''), 'data-label': 'Sell value', text: c.valueText }),
      el('td', { class: 'cell-cat', 'data-label': 'Cost to register', text: c.registerCost === null ? 'Not listed' : money(c.registerCost) }),
      el('td', { class: 'cell-cat', 'data-label': 'Condition scanned', text: dash(c.condition) }),
      note,
    ]);
  }

  function renderCars() {
    var list = visibleCars();
    var frag = document.createDocumentFragment();
    list.forEach(function (c) { frag.appendChild(carRow(c)); });
    carEls.rows.textContent = '';
    carEls.rows.appendChild(frag);
    carEls.empty.hidden = list.length > 0;
    carEls.count.textContent = 'Showing ' + list.length + ' of ' + cars.length + ' cars';
    Array.prototype.forEach.call(carEls.head.children, function (th) {
      if (th.getAttribute('data-key') === carState.sortKey) th.setAttribute('aria-sort', carState.sortDir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
    if (carEls.sort.querySelector('option[value="' + carState.sortKey + '"]')) carEls.sort.value = carState.sortKey;
    return list;
  }

  function setCarSort(key) {
    var first = CAR_COL[key].num ? -1 : 1;
    if (carState.sortKey === key) carState.sortDir = -carState.sortDir;
    else { carState.sortKey = key; carState.sortDir = first; }
    renderCars();
  }

  function resetCars() {
    carState.q = ''; carState.buyer = ''; carState.tracker = ''; carState.sortKey = 'value'; carState.sortDir = -1;
    carEls.q.value = ''; carEls.buyer.value = ''; carEls.tracker.value = '';
    renderCars();
  }

  function showCarResults() {
    var target = $('cars');
    target.scrollIntoView({ block: 'start', behavior: 'auto' });
    target.focus({ preventScroll: true });
  }

  /* "Show these cars" on a buyer card: filter the list to that buyer, best value first. */
  function showBuyer(id) {
    carState.q = ''; carState.tracker = ''; carState.buyer = id; carState.sortKey = 'value'; carState.sortDir = -1;
    carEls.q.value = ''; carEls.tracker.value = ''; carEls.buyer.value = id;
    renderCars();
    $('car-toolbar').scrollIntoView({ block: 'start', behavior: 'auto' });
    $('cars').focus({ preventScroll: true });
  }

  function renderCarNotes() {
    var wrap = $('car-notes');
    (T.carNotes || []).forEach(function (p) { wrap.appendChild(el('p', null, [richText(p)])); });
  }

  function renderBuyers() {
    var wrap = $('buyers');
    (T.carBuyers || []).forEach(function (b) {
      var dl = el('dl');
      b.rows.forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', null, [richText(r[1])]));
      });
      /* Best three scan values this buyer accepts. Disputed trackers are left out. */
      var top = cars.filter(function (c) { return c.buyers.indexOf(b.id) !== -1 && c.sellValue !== null && c.tracker !== 'Disputed'; })
        .sort(function (x, y) { return y.sellValue - x.sellValue || x._i - y._i; }).slice(0, 3);
      var topBlock = el('div', { class: 'buyer-top' }, [el('h4', { text: b.topNote ? 'Top payers' : 'Top scan values' })]);
      if (b.topNote) topBlock.appendChild(el('p', { text: b.topNote }));
      else if (top.length) {
        var ol = el('ol');
        top.forEach(function (c) {
          ol.appendChild(el('li', null, [el('span', { text: (c.brand ? c.brand + ' ' : '') + c.name }), el('strong', { text: c.valueText })]));
        });
        topBlock.appendChild(ol);
      }
      var btn = el('button', { type: 'button', class: 'btn', 'data-buyer': b.id, text: 'Show these cars' });
      btn.addEventListener('click', function () { showBuyer(b.id); });
      wrap.appendChild(el('article', { class: 'buyer' }, [
        el('h3', { text: b.name }),
        el('p', { class: 'buyer-place', text: b.place }),
        dl, topBlock, btn,
      ]));
    });
  }

  /* ---------- Randy's Wish List location cards ---------- */
  /* Evidence tiers, in display order. They describe how well a spot is reported
     in guides. Nothing here was checked in the game for this tracker. */
  var WISH_TIERS = [
    { id: 'Guides agree', tone: 'pos', text: 'Two or more guides name the same place. It is still a report, not a guarantee.' },
    { id: 'Reported sighting', tone: 'warn', text: 'Seen there by a player or named by one guide. It may not be there on every visit.' },
    { id: 'Traffic search', tone: 'warn', text: 'An area to scan, not a parking bay.' },
    { id: 'No fixed spot', tone: 'outline', text: "No guide has located it. Scan matching cars and wait for Randy's delivery prompt." },
  ];
  var WISH_ALL_TEXT = 'The label on each card is an evidence tier: how well the spot is reported in guides. None of these spots were checked in the game for this tracker.';
  var wishCars = cars.filter(function (c) { return c.wish; });
  var wishState = { tier: '' };

  function wishId(c) {
    return 'wish-' + ((c.brand ? c.brand + ' ' : '') + c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function wishTier(id) {
    for (var i = 0; i < WISH_TIERS.length; i++) if (WISH_TIERS[i].id === id) return WISH_TIERS[i];
    return { id: id, tone: '', text: '' };
  }

  function wishCard(c) {
    var w = c.wish;
    var head = el('header', { class: 'wish-head' }, [
      el('div', null, [
        el('p', { class: 'wish-brand', text: c.brand || 'Mission car' }),
        el('h3', { text: c.name }),
      ]),
      badge(w.status, wishTier(w.status).tone),
    ]);
    var spots = el('ul', { class: 'wish-spots' });
    if (w.spots.length) {
      w.spots.forEach(function (sp, i) {
        var li = el('li', null, [
          el('span', { class: 'wish-label', text: w.spots.length === 1 ? 'Where' : (i === 0 ? 'Main spot' : 'Alternate') }),
          el('span', { class: 'wish-where', text: sp.where }),
        ]);
        if (sp.when) li.appendChild(el('span', { class: 'wish-when', text: sp.when }));
        spots.appendChild(li);
      });
    } else {
      spots.appendChild(el('li', null, [
        el('span', { class: 'wish-label', text: 'Where' }),
        el('span', { class: 'wish-where muted', text: 'No fixed spot reported yet' }),
      ]));
    }
    var dl = el('dl');
    function row(label, node) { dl.appendChild(el('dt', { text: label })); dl.appendChild(el('dd', null, [node])); }
    row('You need', document.createTextNode(w.need));
    if (w.how) row('Approach', document.createTextNode(w.how));
    if (w.tracker) row('Tracker', document.createTextNode(w.tracker));
    if (w.caveat) row('Watch for', richText(w.caveat));
    row('Reported pay', document.createTextNode(c.valueText));
    row('List', document.createTextNode(w.list));
    var src = el('p', { class: 'wish-src' }, [document.createTextNode('Sources: ')]);
    w.sources.forEach(function (k, i) {
      if (i) src.appendChild(document.createTextNode(', '));
      src.appendChild(sourceLink(k));
    });
    return el('article', { class: 'wish', id: wishId(c), tabindex: '-1', 'data-tier': w.status }, [head, spots, dl, src]);
  }

  function renderWish() {
    var wrap = $('wish');
    wrap.textContent = '';
    var order = WISH_TIERS.map(function (t) { return t.id; });
    var list = wishCars
      .filter(function (c) { return !wishState.tier || c.wish.status === wishState.tier; })
      .sort(function (a, b) { return order.indexOf(a.wish.status) - order.indexOf(b.wish.status) || a._i - b._i; });
    list.forEach(function (c) { wrap.appendChild(wishCard(c)); });
    var located = wishCars.filter(function (c) { return c.wish.spots.length > 0; }).length;
    $('wish-count').textContent = wishState.tier
      ? 'Showing ' + list.length + ' of ' + wishCars.length + ' cars'
      : located + ' of ' + wishCars.length + ' cars have a reported spot';
    $('wish-tier').textContent = wishState.tier ? wishState.tier + ': ' + wishTier(wishState.tier).text : WISH_ALL_TEXT;
    Array.prototype.forEach.call($('wish-filter').querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tier') === wishState.tier));
    });
  }

  function renderWishControls() {
    (T.wishNotes || []).forEach(function (p) { $('wish-notes').appendChild(el('p', null, [richText(p)])); });
    var wrap = $('wish-filter');
    function add(tier, label, count) {
      var b = el('button', { type: 'button', class: 'chip wish-chip', 'data-tier': tier, 'aria-pressed': 'false' }, [
        el('span', { text: label }),
        el('span', { class: 'wish-chip-n', text: String(count) }),
      ]);
      b.addEventListener('click', function () { wishState.tier = tier; renderWish(); });
      wrap.appendChild(b);
    }
    add('', 'All cars', wishCars.length);
    WISH_TIERS.forEach(function (t) {
      var n = wishCars.filter(function (c) { return c.wish.status === t.id; }).length;
      if (n) add(t.id, t.id, n);
    });
  }

  /* Opens the location card of one car: clears the filter, scrolls to it, focuses it. */
  function showWishCard(c) {
    wishState.tier = '';
    renderWish();
    var card = $(wishId(c));
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'auto' });
    card.focus({ preventScroll: true });
  }

  function renderCarControls() {
    carEls.buyer.appendChild(el('option', { value: '', text: 'All buyers' }));
    BUYER_ORDER.forEach(function (b) { carEls.buyer.appendChild(el('option', { value: b, text: b })); });
    carEls.buyer.appendChild(el('option', { value: 'none', text: 'No confirmed buyer' }));
    fillSelect(carEls.tracker, 'All trackers', TRACKER_ORDER.filter(function (t) { return cars.some(function (c) { return c.tracker === t; }); }));
    [['value', 'Sell value'], ['register', 'Cost to register'], ['name', 'Vehicle'], ['brand', 'Brand'], ['tracker', 'Tracker'], ['buyer', 'Sells to']].forEach(function (o) {
      carEls.sort.appendChild(el('option', { value: o[0], text: o[1] }));
    });
    CAR_COLUMNS.forEach(function (c) {
      if (!c.sort) { carEls.head.appendChild(el('th', { scope: 'col', class: 'th-plain', text: c.label })); return; }
      var btn = el('button', { type: 'button', class: 'sort-btn', 'data-key': c.key }, [
        el('span', { text: c.label }),
        svg('M8 12V4M4.5 7.5 8 4l3.5 3.5', 'arrow'),
      ]);
      btn.addEventListener('click', function () { setCarSort(c.key); });
      carEls.head.appendChild(el('th', { scope: 'col', 'data-key': c.key }, [btn]));
    });
  }

  function bindCars() {
    carEls.q.addEventListener('input', function () { carState.q = carEls.q.value; renderCars(); });
    carEls.buyer.addEventListener('change', function () { carState.buyer = carEls.buyer.value; renderCars(); });
    carEls.tracker.addEventListener('change', function () { carState.tracker = carEls.tracker.value; renderCars(); });
    carEls.sort.addEventListener('change', function () {
      carState.sortKey = carEls.sort.value;
      carState.sortDir = CAR_COL[carState.sortKey].num ? -1 : 1;
      renderCars();
    });
    $('car-toolbar').addEventListener('submit', function (ev) {
      ev.preventDefault();
      carState.q = carEls.q.value;
      renderCars();
      showCarResults();
    });
    $('car-reset').addEventListener('click', resetCars);
    $('car-reset-empty').addEventListener('click', resetCars);
    $('car-export').addEventListener('click', function () { download(T.toCarsCsv(visibleCars()), 'gta6_car_values.csv'); });
  }


  function renderFacts() {
    var priced = cars.filter(function (c) { return c.sellValue != null; });
    var top = priced.slice().sort(function (a, b) { return b.sellValue - a.sellValue; })[0];
    var wish = cars.filter(function (c) { return c.wishList; });
    var facts = [
      ['Cars tracked', String(cars.length), priced.length + ' with a published scan value'],
      ['Highest scan value', top ? money(top.sellValue) : 'None', top ? top.name : ''],
      ['Randy Wish List cars', String(wish.length), 'Each has a location card below'],
      ['Platforms', T.meta.platformsLive, T.meta.platformsNote || ''],
    ];
    var wrap = $('facts');
    facts.forEach(function (f) {
      var dd = el('dd', { text: f[1] });
      dd.appendChild(el('small', { text: f[2] }));
      wrap.appendChild(el('div', { class: 'fact' }, [el('dt', { text: f[0] }), dd]));
    });
    $('asof-date').textContent = T.meta.asOf;
  }

  function bindJumps() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-jump]'), function (link) {
      link.addEventListener('click', function (ev) {
        ev.preventDefault();
        var target = $(link.getAttribute('data-jump'));
        if (!target) return;
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
        target.focus({ preventScroll: true });
      });
    });
  }

  renderFacts();
  renderFootnotes();
  renderVersion();
  renderCarNotes();
  renderCarControls();
  renderBuyers();
  renderWishControls();
  renderWish();
  bindCars();
  bindJumps();
  renderCars();
})();
