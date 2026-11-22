// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, and the live-token view. No network: every byte it shows is
// in data.js. The page recomputes each row from the snapshot figures and checks the number the
// board carries, so the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var watch = {};
  DATA.rows.forEach(function (r) { if (r.watch) watch[r.slug] = true; });
  var state = { q: '', category: 'all', chain: 'all', tab: 'board', sort: 'implied_value_usd', dir: -1, selected: null };
  var WATCH = DATA.rows.filter(function (r) { return r.watch; }).length;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // The model in one function, mirroring lib/model.ts: the peer multiple is the category's own
  // median mcap/TVL over the snapshot's live-token protocols (3+ peers, else the global median).
  function multipleOf(row) {
    var key = row.category || 'Uncategorised';
    var own = DATA.peers.by_category[key];
    if (own !== undefined) return { multiple: own, peers: DATA.peers.peers[key] || 0, fallback: false };
    return { multiple: DATA.peers.global, peers: DATA.peers.peers[key] || 0, fallback: true };
  }
  function impliedOf(row, model) {
    var m = multipleOf(row);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(row.chains.length - 1, 0), model.chain_cap);
    var implied = Math.max(1, Math.round(row.tvl_usd * m.multiple * growthMult * maturity * chainMult));
    return { implied: implied, multiple: m.multiple, peers: m.peers, fallback: m.fallback, growth: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: age };
  }

  // radar-3 readiness (0-100), mirroring lib/model.ts: peer support 40/20/10,
  // growth mapped from [-60, +120] to 0-30, maturity mapped from [0.60, 1.00] to 0-30.
  function readinessOf(row) {
    var calc = impliedOf(row, DATA.model);
    var peerPts = calc.peers >= 3 ? 40 : calc.peers >= 1 ? 20 : 10;
    var growthPts = Math.max(0, Math.min(30, Math.round(((calc.growth + 60) / 180) * 30)));
    var matPts = Math.max(0, Math.min(30, Math.round(((calc.maturity - 0.6) / 0.4) * 30)));
    return { readiness: peerPts + growthPts + matPts, peer: peerPts, growth: growthPts, maturity: matPts };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s best vault on " + chain + ' and keep the shares.';
    if (c.indexOf('yield') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('card') >= 0 || c.indexOf('payment') >= 0) return 'Top up $' + capital + ' through ' + name + ' on ' + chain + ' and spend from the balance.';
    if (c.indexOf('governance') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and vote once with the position.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var chains = p.chains || [];
    var other = chains.length > 1 ? chains[1] : chain;
    var c = (p.category || '').toLowerCase();
    if (chains.length > 1) return 'Repeat the position on ' + other + ' with $' + Math.max(25, Math.round(capital / 2)) + ' so the farm spans two chains.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supplied collateral and repay it within the week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return "Swap a small amount through " + p.name + "'s pool on " + chain + ' and add the proceeds to the position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + p.name + ' to show two-way use.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim any staking rewards the position earned and restake them.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge, then open a fresh one half the size.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Move a quarter of the vault deposit into a second ' + p.name + ' vault on ' + chain + '.';
    return 'Make a second qualifying action on ' + p.name + ' on ' + chain + ', such as a swap, a vote or a small extra deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $3 of gas', time: '15 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function visibleRows() {
    var rows = DATA.rows;
    if (state.tab === 'watchlist') rows = rows.filter(function (r) { return r.watch; });
    if (state.category !== 'all') rows = rows.filter(function (r) { return (r.category || 'Uncategorised') === state.category; });
    if (state.chain !== 'all') rows = rows.filter(function (r) { return (r.chains || []).indexOf(state.chain) >= 0; });
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) { return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.toLowerCase().indexOf(q) >= 0 || (r.category || '').toLowerCase().indexOf(q) >= 0; });
    }
    var k = state.sort;
    rows = rows.slice().sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === 'string') return (av < bv ? -1 : av > bv ? 1 : 0) * state.dir;
      return (av - bv) * state.dir;
    });
    return rows;
  }

  function sortButton(label, key) {
    var arrow = state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : '';
    return el('button', { text: label + arrow, onclick: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } });
  }

  // radar-3 spotlight: the top 10 by implied value, as cards with a bar chart,
  // so the best launches are visible before the full table.
  function renderSpotlight() {
    var top = DATA.rows.slice(0, 10);
    if (top.length === 0) return el('div');
    var maxImp = top[0].implied_value_usd || 1;
    var sec = el('section', { class: 'spot' });
    sec.appendChild(el('h2', { text: 'Top 10 to watch' }));
    sec.appendChild(el('p', { class: 'spot-sub', text: 'The highest implied values on the board — click any card for its detail view and farm plan.' }));
    var chart = el('div', { class: 'chart' });
    top.forEach(function (r) {
      var row = el('div', { class: 'crow' });
      row.appendChild(el('span', { class: 'cnum', text: '#' + r.rank }));
      row.appendChild(el('span', { class: 'cname', text: r.name }));
      var cbar = el('div', { class: 'cbar' });
      cbar.appendChild(el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImp)) + '%' }));
      row.appendChild(cbar);
      row.appendChild(el('span', { class: 'cval', text: fmtUsd(r.implied_value_usd) }));
      chart.appendChild(row);
    });
    sec.appendChild(chart);
    var cards = el('div', { class: 'cards' });
    top.forEach(function (r) {
      var ready = readinessOf(r);
      var card = el('button', { class: 'card', onclick: function () { openDetail(r.slug); } });
      card.appendChild(el('div', { class: 'card-rank', text: '#' + r.rank }));
      card.appendChild(el('div', { class: 'card-name', text: r.name }));
      card.appendChild(el('div', { class: 'card-imp', text: fmtUsd(r.implied_value_usd) }));
      card.appendChild(el('div', { class: 'card-rdy', text: 'Readiness ' + ready.readiness + '/100 · ' + (r.category || 'Uncategorised') }));
      cards.appendChild(card);
    });
    sec.appendChild(cards);
    return sec;
  }

  function renderBoardTable() {
    var rows = visibleRows();
    var maxImp = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
    var table = el('table', { class: 'board' });
    table.appendChild(el('caption', { text: state.tab === 'watchlist' ? 'Watchlist — the 40 protocols at or above the $50M floor that record no token' : 'Ranked board — every pre-token protocol on the radar, by implied value' }));
    var head = el('tr');
    head.appendChild(el('th', { class: 'num' }, sortButton('#', 'rank')));
    head.appendChild(el('th', {}, sortButton('Protocol', 'name')));
    head.appendChild(el('th', {}, sortButton('Category', 'category')));
    head.appendChild(el('th', {}, el('span', { text: 'Chains' })));
    head.appendChild(el('th', { class: 'num' }, sortButton('TVL', 'tvl_usd')));
    head.appendChild(el('th', { class: 'num' }, sortButton('7d', 'change_7d')));
    head.appendChild(el('th', { class: 'num' }, sortButton('Age', 'age_days')));
    head.appendChild(el('th', { class: 'num' }, sortButton('Multiple', 'peer_multiple')));
    head.appendChild(el('th', { class: 'num' }, sortButton('Readiness', 'readiness')));
    head.appendChild(el('th', { class: 'num' }, sortButton('Implied value', 'implied_value_usd')));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    if (rows.length === 0) {
      body.appendChild(el('tr', {}, el('td', { colspan: 10, class: 'empty', text: 'Nothing on the radar matches that filter.' })));
    }
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : '', onclick: function () { openDetail(r.slug); } });
      var pct = el('span', { class: (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
      var imp = el('div');
      imp.appendChild(el('span', { class: 'imp', text: fmtUsd(r.implied_value_usd) }));
      var bar = el('div', { class: 'bar' });
      bar.appendChild(el('i', { style: 'width:' + Math.max(2, Math.round(100 * r.implied_value_usd / maxImp)) + '%' }));
      imp.appendChild(bar);
      var ready = readinessOf(r);
      var rdy = el('div');
      rdy.appendChild(el('span', { class: 'rdy' + (ready.readiness >= 70 ? ' hi' : ready.readiness >= 50 ? ' mid' : ' lo'), text: String(ready.readiness) }));
      var rbar = el('div', { class: 'bar rbar' });
      rbar.appendChild(el('i', { style: 'width:' + ready.readiness + '%' }));
      rdy.appendChild(rbar);
      tr.appendChild(el('td', { class: 'num' }, el('span', { class: 'rank' + (r.rank <= 3 ? ' top' : ''), text: String(r.rank) })));
      var nameCell = el('td');
      nameCell.appendChild(el('span', { class: 'name', text: r.name + ' ' }));
      nameCell.appendChild(el('span', { class: 'slug', text: r.slug }));
      if (r.watch) nameCell.appendChild(el('span', { class: 'badge watch', text: ' WATCHLIST' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || 'Uncategorised' }));
      tr.appendChild(el('td', { text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num' }, pct));
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num', text: r.peer_multiple !== null && r.peer_multiple !== undefined ? r.peer_multiple.toFixed(2) + '×' : 'n/a' }));
      tr.appendChild(el('td', { class: 'num' }, rdy));
      tr.appendChild(el('td', { class: 'num' }, imp));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return { table: table, count: rows.length };
  }

  function renderLiveTable() {
    var table = el('table', { class: 'board' });
    table.appendChild(el('caption', { text: 'Live tokens — protocols whose token already trades, shown at the market\u2019s own value, never mixed into the ranked board' }));
    var head = el('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d', 'Mcap / TVL'].forEach(function (h, i) {
      head.appendChild(el('th', { class: i >= 3 ? 'num' : '' }, el('span', { text: h })));
    });
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, el('span', { class: 'name', text: r.name + ' ' }), el('span', { class: 'slug', text: r.slug })));
      tr.appendChild(el('td', { text: r.category || 'Uncategorised' }));
      tr.appendChild(el('td', { text: (r.chains || []).slice(0, 3).join(', ') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num' }, el('span', { class: (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) })));
      tr.appendChild(el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + '×' : 'n/a' }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    renderTableOnly();
    var calc = impliedOf(row, DATA.model);
    var drawer = el('div', { class: 'drawer', role: 'dialog', 'aria-label': row.name + ' detail' });
    drawer.appendChild(el('button', { class: 'close', text: 'Close ✕', onclick: function () { state.selected = null; location.hash = ''; render(); } }));
    drawer.appendChild(el('p', { class: 'eyebrow', text: 'Rank #' + row.rank + ' · ' + (row.watch ? 'Watchlist' : 'Early radar') }));
    drawer.appendChild(el('h2', { text: row.name }));
    drawer.appendChild(el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · listed ' + (row.listed_at || 'unknown') }));
    var kv = el('div', { class: 'kv' });
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(row.tvl_usd) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: '7-day change' }), el('div', { class: 'v', text: fmtPct(row.change_7d) })));
    kv.appendChild(el('div', {}, el('div', { class: 'k', text: 'Age (no token)' }), el('div', { class: 'v', text: fmtAge(row.age_days) })));
    drawer.appendChild(kv);
    var math = el('table', { class: 'math' });
    math.appendChild(el('tr', {}, el('th', { text: 'How the value is built' }), el('th', { text: 'Figure' }), el('th', { text: '×' })));
    function mrow(label, figure, mult) {
      math.appendChild(el('tr', {}, el('td', { text: label }), el('td', { text: figure }), el('td', { text: mult })));
    }
    mrow('TVL', fmtUsd(row.tvl_usd), '—');
    mrow('Peer multiple (' + (row.category || 'Uncategorised') + (calc.fallback ? ', global fallback' : ', ' + calc.peers + ' live peers') + ')', calc.multiple.toFixed(3) + '×', calc.multiple.toFixed(3) + '×');
    mrow('7-day growth ' + fmtPct(row.change_7d), calc.growthMult.toFixed(4) + '×', calc.growthMult.toFixed(4) + '×');
    mrow('Maturity (' + fmtAge(row.age_days) + ' with no token)', calc.maturity.toFixed(4) + '×', calc.maturity.toFixed(4) + '×');
    mrow('Chain spread (' + (row.chains || []).length + ' chains)', calc.chainMult.toFixed(4) + '×', calc.chainMult.toFixed(4) + '×');
    math.appendChild(el('tr', { class: 'total' }, el('td', { text: 'Implied value' }), el('td', { text: fmtUsd(row.implied_value_usd) }), el('td', { text: calc.implied === row.implied_value_usd ? '✓ matches board' : 'recomputed ' + fmtUsd(calc.implied) })));
    drawer.appendChild(math);
    var ready = readinessOf(row);
    var rdy = el('table', { class: 'math' });
    rdy.appendChild(el('tr', {}, el('th', { text: 'Readiness — how well-supported the launch is' }), el('th', { text: 'Points' }), el('th', { text: 'of' })));
    rdy.appendChild(el('tr', {}, el('td', { text: 'Peer support (' + calc.peers + ' live peers behind the multiple)' }), el('td', { text: String(ready.peer) }), el('td', { text: '40' })));
    rdy.appendChild(el('tr', {}, el('td', { text: 'Growth (' + fmtPct(row.change_7d) + ' in 7 days)' }), el('td', { text: String(ready.growth) }), el('td', { text: '30' })));
    rdy.appendChild(el('tr', {}, el('td', { text: 'Maturity (' + fmtAge(row.age_days) + ' with no token)' }), el('td', { text: String(ready.maturity) }), el('td', { text: '30' })));
    rdy.appendChild(el('tr', { class: 'total' }, el('td', { text: 'Readiness' }), el('td', { text: String(ready.readiness) }), el('td', { text: '100' })));
    drawer.appendChild(rdy);
    var cap = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    drawer.appendChild(el('p', { class: 'farm-sum', html: '<b>Farm at a glance:</b> $' + cap + ' capital · hold ' + hold + ' days · 7 steps · about 50 minutes of active time.' }));
    drawer.appendChild(el('h3', { text: 'Farm plan — 7 steps' }));
    var steps = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) {
      var parts = s.split(' Cost: ');
      var head = parts[0] || s;
      var tail = parts[1] ? 'Cost: ' + parts[1] : '';
      var li = el('li', {}, el('div', { text: head }));
      if (tail) li.appendChild(el('div', { class: 'cost', text: tail }));
      steps.appendChild(li);
    });
    drawer.appendChild(steps);
    drawer.appendChild(el('p', { class: 'note', text: 'This protocol records no token in the snapshot (no market cap, no CoinGecko id, no symbol). That is the record as DefiLlama carries it, not proof it has none — and this board never predicts whether or when a token is issued, only what one would be worth if the record stayed as it is.' }));
    var scrim = el('div', { class: 'scrim', onclick: function () { state.selected = null; location.hash = ''; render(); } });
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    while (app.firstChild) app.removeChild(app.firstChild);
    document.querySelectorAll('.drawer, .scrim').forEach(function (n) { n.remove(); });
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(el('p', { class: 'eyebrow', text: 'Token Radar · ' + DATA.model_version + ' · Snapshot ' + DATA.as_of }));
    wrap.appendChild(el('h1', { html: 'Token Radar <span class="thin">— the pre-token board</span>' }));
    wrap.appendChild(el('p', { class: 'lede', html: 'Every protocol DefiLlama tracks that <b>records no token</b>, ranked by what its token would be worth if its record stayed as it is. The watchlist is the floor, never the ceiling: the board carries all <b>' + DATA.watchlist_size + ' watchlist protocols</b> plus <b>' + DATA.early_size + ' early ones</b> below the floor. Click any row for its detail view and farm plan.' }));
    var stats = el('div', { class: 'stats' });
    [['Protocols in snapshot', String(DATA.protocols_total)], ['Watchlist', String(DATA.watchlist_size)], ['Board rows', String(DATA.board_size)], ['Top implied value', fmtUsd(DATA.rows.length ? DATA.rows[0].implied_value_usd : 0)]].forEach(function (s) {
      stats.appendChild(el('div', { class: 'stat' }, el('div', { class: 'n', text: s[1] }), el('div', { class: 'l', text: s[0] })));
    });
    wrap.appendChild(stats);
    wrap.appendChild(renderSpotlight());
    wrap.appendChild(el('p', { class: 'model-line', html: '<b>Model ' + DATA.model_version + ':</b> implied value = TVL × <code>peer multiple</code> × growth × maturity × chains. The peer multiple is the category\u2019s median market-cap / TVL over the snapshot\u2019s own live-token protocols (3+ peers, else the global median ' + DATA.peers.global.toFixed(3) + '×); growth is the 7-day TVL change clamped to [−60%, +120%] at half weight; maturity rises from 0.60 to 1.00 over three years with no token; each extra chain adds 2%, to +20%. <b>Readiness (0–100)</b> scores how well-supported a launch is: peer support 40 (3+ live peers), growth 30, maturity 30. No protocol name is ever special-cased.' }));
    var controls = el('div', { class: 'controls' });
    var tabs = el('div', { class: 'tabs' });
    [['board', 'Board'], ['watchlist', 'Watchlist (' + DATA.watchlist_size + ')'], ['live', 'Live tokens']].forEach(function (t) {
      tabs.appendChild(el('button', { class: 'tab', 'aria-pressed': state.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.tab = t[0]; render(); } }));
    });
    controls.appendChild(tabs);
    var cats = ['all'];
    DATA.rows.forEach(function (r) { var c = r.category || 'Uncategorised'; if (cats.indexOf(c) < 0) cats.push(c); });
    cats.sort();
    var sel = el('select', { class: 'cat', 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } });
    cats.forEach(function (c) {
      var o = el('option', { value: c, text: c === 'all' ? 'All categories' : c });
      if (state.category === c) o.selected = true;
      sel.appendChild(o);
    });
    controls.appendChild(sel);
    var chainList = ['all'];
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { if (chainList.indexOf(c) < 0) chainList.push(c); }); });
    chainList.sort();
    var chainSel = el('select', { class: 'cat', 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; render(); } });
    chainList.forEach(function (c) {
      var o = el('option', { value: c, text: c === 'all' ? 'All chains' : c });
      if (state.chain === c) o.selected = true;
      chainSel.appendChild(o);
    });
    controls.appendChild(chainSel);
    controls.appendChild(el('input', { class: 'search', type: 'search', placeholder: 'Search name, slug or category…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; renderTableOnly(); } }));
    wrap.appendChild(controls);
    var count = el('p', { class: 'count', id: 'rowcount' });
    wrap.appendChild(count);
    var holder = el('div', { id: 'tableholder' });
    wrap.appendChild(holder);
    app.appendChild(wrap);
    var method = el('section', { class: 'method' });
    method.appendChild(el('h2', { text: 'How the radar works' }));
    method.appendChild(el('p', { html: 'A launch is priced the way the market already prices live tokens that do the same job. For each category, the peer multiple is the median of <code>market cap / TVL</code> across the snapshot\u2019s live-token protocols in that category; a category with fewer than three live peers falls back to the global median. The board separates the two worlds: the ranked board holds only protocols that record no token, and the live-token view shows the protocols whose token already trades at the market\u2019s own value.' }));
    var peers = el('table', { class: 'peers' });
    peers.appendChild(el('tr', {}, el('th', { text: 'Category' }), el('th', { text: 'Live peers' }), el('th', { text: 'Peer multiple' })));
    Object.keys(DATA.peers.by_category).sort().forEach(function (c) {
      peers.appendChild(el('tr', {}, el('td', { text: c }), el('td', { text: String(DATA.peers.peers[c] || 0) }), el('td', { text: DATA.peers.by_category[c].toFixed(3) + '×' })));
    });
    peers.appendChild(el('tr', {}, el('td', { text: 'Global fallback (every live-token protocol)' }), el('td', { text: '—' }), el('td', { text: DATA.peers.global.toFixed(3) + '×' })));
    method.appendChild(peers);
    method.appendChild(el('p', { html: 'Each farm plan is derived from the protocol\u2019s own record — its category decides the action, its TVL decides the capital ($50–$250), its age decides the hold (30–60 days) — with what each step costs and how long it takes. Nothing here predicts whether or when a token is issued.' }));
    wrap.appendChild(method);
    wrap.appendChild(el('footer', { text: 'Source: ' + DATA.source + '. Implied values are this entry\u2019s own model (' + DATA.model_version + '), not a prediction and never make.fun\u2019s claim. Built from the sealed snapshot of ' + DATA.as_of + '; the page runs with no network.' }));
    renderTableOnly();
    if (state.selected) openDetail(state.selected);
  }

  function renderTableOnly() {
    var holder = document.getElementById('tableholder');
    var count = document.getElementById('rowcount');
    if (!holder) return;
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    if (state.tab === 'live') {
      holder.appendChild(renderLiveTable());
      if (count) count.textContent = DATA.live_size + ' live-token protocols, by market cap';
    } else {
      var out = renderBoardTable();
      holder.appendChild(out.table);
      if (count) count.textContent = out.count + ' of ' + DATA.board_size + ' rows shown';
    }
  }

  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    var parts = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (parts.tab === 'board' || parts.tab === 'watchlist' || parts.tab === 'live') state.tab = parts.tab;
    if (parts.category) state.category = parts.category;
    if (parts.detail) state.selected = parts.detail;
  }

  applyHash();
  render();
})();
