// Sales this show: the host's live seller analytics in the Shop panel (like Whatnot's live seller panel).
// Totals for shop sales, auction wins and super chats, top buyers, best sellers, and a CSV of every line.
// The server builds the report from its own ledger (lib/watch.js hostSales); this file asks for it and shows it.

const $ = (s, r = document) => r.querySelector(s);
const money = (c) => '$' + ((c || 0) / 100).toFixed((c || 0) % 100 ? 2 : 0);
const KIND = { sale: 'Shop sale', auction: 'Auction win', superchat: 'Super chat' };
const STATUS = { reserved: 'paid off-site', won: 'awaiting payment', paid: 'paid by card' };

let report = null, api = null, lastAsk = 0;

export function buildSales(a) {
  api = a;
  const d = document.createElement('details');
  d.className = 'psec'; d.dataset.sec = 'shop-sales'; d.open = true;
  d.innerHTML = `<summary><b>Sales this show</b><span class="hint">live, from every sale, auction and super chat</span></summary>
    <div class="psec-body form">
      <div class="sales-tiles" id="salesTiles"></div>
      <div class="sales-lists" id="salesLists" hidden>
        <div><b class="sales-sub">Top buyers</b><ol class="le-bids" id="salesBuyers"></ol></div>
        <div><b class="sales-sub">Best sellers</b><ol class="le-bids" id="salesItems"></ol></div>
      </div>
      <p class="hint" id="salesEmpty">No sales yet. They show up here the moment someone buys, wins an auction or sends a super chat.</p>
      <div class="row"><button type="button" class="btn sm" id="salesCsv" disabled>Download CSV</button><button type="button" class="btn sm ghost" id="salesRefresh">Refresh</button></div>
    </div>`;
  $('#salesRefresh', d).onclick = () => ask(true);
  $('#salesCsv', d).onclick = downloadCsv;
  render(d);
  return d;
}

/** Ask the server for the report: every few seconds while the Shop panel is open, or right away. */
export function ask(now = false) {
  if (!api?.isHost() || !api.inStudio()) return;
  const open = !$('.panel[data-panel="shop"]')?.hidden;
  const t = Date.now();
  if (!now && (!open || t - lastAsk < 5000)) return;
  lastAsk = t;
  api.send({ type: 'sales' });
}

export function onSales(m) { report = m.report || null; render(); }

function tile(label, value, sub) {
  const el = document.createElement('div'); el.className = 'sales-tile';
  const v = document.createElement('b'); v.className = 'num'; v.textContent = value;
  const l = document.createElement('span'); l.textContent = label;
  el.append(v, l);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.append(s); }
  return el;
}
function list(ol, rows, fmt) {
  ol.replaceChildren(...rows.map((r) => { const li = document.createElement('li'); li.textContent = fmt(r); return li; }));
}

function render(root = document) {
  const tiles = $('#salesTiles', root); if (!tiles) return;
  const r = report;
  const n = (x) => (x ? `${x.count} · ${money(x.cents)}` : '0');
  tiles.replaceChildren(
    tile('Total', money(r?.gross), r ? `${r.buyers} ${r.buyers === 1 ? 'buyer' : 'buyers'} · ${r.viewers} ${r.viewers === 1 ? 'viewer' : 'viewers'}` : ''),
    tile('Shop sales', n(r?.sales)),
    tile('Auctions', n(r?.auctions)),
    tile('Super chats', n(r?.supers)),
  );
  const has = !!r?.rows?.length;
  $('#salesLists', root).hidden = !has;
  $('#salesEmpty', root).hidden = has;
  $('#salesCsv', root).disabled = !has;
  if (has) {
    list($('#salesBuyers', root), r.topBuyers, (b) => `${b.name} · ${money(b.cents)} (${b.count})`);
    list($('#salesItems', root), r.topItems, (it) => `${it.title} · ${it.count} sold · ${money(it.cents)}`);
  }
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
function downloadCsv() {
  if (!report?.rows?.length) return;
  const lines = [['Time', 'Type', 'Buyer', 'Item or message', 'Amount', 'Status']];
  for (const r of report.rows) lines.push([new Date(r.ts).toISOString(), KIND[r.kind] || r.kind, r.name, r.title, (r.cents / 100).toFixed(2), STATUS[r.status] || r.status]);
  const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `gather-sales-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
