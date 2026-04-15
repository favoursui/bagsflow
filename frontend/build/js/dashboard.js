import Chart from 'https://cdn.jsdelivr.net/npm/chart.js/auto/+esm';

/**
 * BAGS//FLOW — On-Chain Order Flow Dashboard
 * dashboard.js — All UI logic + Real-time data from Helius/Bags.fm
*/


const WHALE_THRESHOLD  = 500;           // USD — trades above this are "whales"
const MAX_FEED_ROWS    = 80;            // max rows kept in live feed
const WS_URL = 'wss://bagsflow-production.up.railway.app/ws';

// STATE

const state = {
  stats:       { vol: 0, trades: 0, whales: 0, buys: 0, sells: 0, buyVol: 0, sellVol: 0, startTime: null },
  leaderboard: {},
  chart:       null,
  connected:   false,
};




// FORMATTERS

function fmtUSD(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtPrice(n) {
  if (n < 0.0001) return '$' + n.toExponential(2);
  return '$' + n.toFixed(6);
}
function fmtWallet(w) { return w.slice(0, 4) + '···' + w.slice(-4); }
function fmtTime(d)   { return d.toTimeString().slice(0, 8); }
function fmtNum(n)    {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(2)+'M';
  if (n >= 1_000)     return (n/1_000).toFixed(1)+'K';
  return n.toFixed(2);
}
function fmtAge(d) {
  if (!d || isNaN(d.getTime())) return 'new';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 0)    return 'new';
  if (s < 60)   return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  return Math.floor(s/3600) + 'h';
}


// MODULE 1 — LIVE TRADE FEED

function addToFeed(trade) {
  const list    = document.getElementById('feed-list');
  const row     = document.createElement('div');
  const isBuy   = trade.side === 'BUY';
  const isWhale = trade.amount >= WHALE_THRESHOLD;
  row.className = 'feed-row new-row';

  row.innerHTML = `
    <span style="font-family:var(--font-mono);color:var(--muted);">${fmtTime(trade.time)}</span>
    <span class="${isBuy ? 'side-buy' : 'side-sell'}">${isBuy ? '▲ BUY' : '▼ SELL'}</span>
    <span style="font-family:var(--font-mono);color:var(--cyan);font-weight:600;">$${trade.token}</span>
    <span style="font-family:var(--font-mono);color:var(--muted);" title="${trade.wallet}">${fmtWallet(trade.wallet)}</span>
    <span style="font-family:var(--font-mono);color:${isWhale ? 'var(--gold)' : 'var(--text)'};">${fmtUSD(trade.amount)}</span>
  `;

  list.prepend(row);
  while (list.children.length > MAX_FEED_ROWS) list.removeChild(list.lastChild);
  document.getElementById('feed-count').textContent = list.children.length + ' trades';
}




// MODULE 2 — WHALE ALERTS

function addToWhale(trade) {
  const list  = document.getElementById('whale-list');
  const item  = document.createElement('div');
  item.className = 'whale-item whale-flash';
  const isBuy = trade.side === 'BUY';
  const color = isBuy ? 'var(--green)' : 'var(--red)';
  const arrow = isBuy ? '▲' : '▼';

  item.innerHTML = `
    <span style="color:${color};font-weight:700;margin-right:4px;">${arrow}</span>
    <span style="font-family:var(--font-mono);color:var(--cyan);font-weight:700;">$${trade.token}</span>
    <span style="font-family:var(--font-mono);color:var(--muted);flex:1;padding:0 8px;overflow:hidden;text-overflow:ellipsis;" title="${trade.wallet}">${fmtWallet(trade.wallet)}</span>
    <span style="font-family:var(--font-mono);color:var(--gold);font-weight:700;">${fmtUSD(trade.amount)}</span>
    <span style="font-family:var(--font-mono);color:var(--muted);margin-left:8px;">${fmtTime(trade.time)}</span>
  `;

  list.prepend(item);
  while (list.children.length > 25) list.removeChild(list.lastChild);
}



// MODULE 3 — NET ORDER FLOW CHART

const chartTokens = [];   // populated by real trades
const buyData     = [];
const sellData    = [];

function initChart() {
  const ctx = document.getElementById('flow-chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartTokens,
      datasets: [
        {
          label: 'Buy Volume',
          data: buyData,
          backgroundColor: 'rgba(0,230,118,0.65)',
          borderColor:     'rgba(0,230,118,0.9)',
          borderWidth: 1,
          borderRadius: 3,
        },
        {
          label: 'Sell Volume',
          data: sellData,
          backgroundColor: 'rgba(255,23,68,0.65)',
          borderColor:     'rgba(255,23,68,0.9)',
          borderWidth: 1,
          borderRadius: 3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: {
          labels: {
            color: '#555577',
            font: { size: 10, family: 'Share Tech Mono' },
            boxWidth: 10,
            padding: 10,
          }
        },
        tooltip: {
          backgroundColor: '#0e0e1a',
          borderColor: '#1e1e35',
          borderWidth: 1,
          titleColor: '#18ffff',
          bodyColor: '#e0e0f0',
          callbacks: {
            label: ctx => ' ' + ctx.dataset.label + ': ' + fmtUSD(ctx.raw)
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#555577', font: { size: 9 } },
          grid:  { color: 'rgba(30,30,53,0.4)' },
        },
        y: {
          ticks: {
            color: '#555577',
            font: { size: 9 },
            callback: v => fmtUSD(v),
          },
          grid: { color: 'rgba(30,30,53,0.4)' },
          beginAtZero: true,
        }
      }
    }
  });
}

function updateChart(token, side, amount) {
  if (!token) return;
  let idx = chartTokens.indexOf(token);
  // Add new token to chart dynamically (max 12)
  if (idx === -1 && chartTokens.length < 12) {
    chartTokens.push(token);
    buyData.push(0);
    sellData.push(0);
    idx = chartTokens.length - 1;
    state.chart.data.labels    = chartTokens;
    state.chart.data.datasets[0].data = buyData;
    state.chart.data.datasets[1].data = sellData;
  }
  if (idx === -1) return;
  if (side === 'BUY')  buyData[idx]  += amount;
  else                 sellData[idx] += amount;
  state.chart.update('none');
}


// MODULE 4 — TOP TRADERS LEADERBOARD

let lbTimer = 0;

function updateLeaderboard(trade) {
  const w = trade.wallet;
  if (!state.leaderboard[w]) {
    state.leaderboard[w] = { wallet: w, vol: 0, trades: 0 };
  }
  state.leaderboard[w].vol    += trade.amount;
  state.leaderboard[w].trades += 1;

  // Refresh display every 5 trades
  lbTimer++;
  if (lbTimer % 5 === 0) {
    renderLeaderboard();
    // Also refresh session traders panel if on session tab
    if (_traderTf === 'session') {
      const tl = document.getElementById('traders-list');
      if (tl) renderSessionTraders(tl);
    }
  }
}

function renderLeaderboard() {
  const list   = document.getElementById('lb-list');
  const sorted = Object.values(state.leaderboard)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 20);

  list.innerHTML = '';
  sorted.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const rankColor = i < 3 ? 'var(--gold)' : 'var(--muted)';
    row.innerHTML = `
      <span style="font-family:var(--font-mono);color:${rankColor};">${medal}</span>
      <span style="font-family:var(--font-mono);color:var(--muted);" title="${entry.wallet}">${fmtWallet(entry.wallet)}</span>
      <span style="font-family:var(--font-mono);color:var(--green);">${fmtUSD(entry.vol)}</span>
      <span style="font-family:var(--font-mono);color:var(--muted);">${entry.trades}</span>
    `;
    list.appendChild(row);
  });
}


// MODULE 5 — NEW TOKEN LAUNCHES

function addLaunch(launch) {
  const list   = document.getElementById('launch-list');
  if (!list) return;
  // Track mint to avoid duplicates with loadLaunches
  const mintKey = launch.mint || launch.symbol;
  if (mintKey) {
    if (_seenLaunchMints.has(mintKey)) return;
    _seenLaunchMints.add(mintKey);
  }
  // Remove placeholder if present
  const ph = list.querySelector('div[style]');
  if (ph) ph.remove();
  const row    = document.createElement('div');
  row.className = 'launch-row';
  const symbol = launch.symbol || launch.name || '???';
  const mcap   = launch.marketCap > 0 ? fmtUSD(launch.marketCap) : '—';
  const price  = launch.price > 0 ? fmtPrice(launch.price) : '—';
  const chg    = (launch.priceChange24h !== undefined && launch.priceChange24h !== 0)
    ? `<span style="color:${launch.priceChange24h >= 0 ? 'var(--green)' : 'var(--red)'};">${launch.priceChange24h >= 0 ? '+' : ''}${launch.priceChange24h.toFixed(1)}%</span>`
    : `<span style="color:var(--muted);">—</span>`;
  const link   = launch.mint
    ? `<a href="https://solscan.io/token/${launch.mint}" target="_blank" style="color:var(--cyan);font-weight:700;text-decoration:none;">$${symbol}</a>`
    : `<span style="color:var(--cyan);font-weight:700;">$${symbol}</span>`;
  row.innerHTML = `${link}<span style="font-family:var(--font-mono);color:var(--text);text-align:right;">${mcap}</span><span style="font-family:var(--font-mono);color:var(--muted);text-align:right;">${price}</span>${chg}`;
  list.prepend(row);
  while (list.children.length > 40) list.removeChild(list.lastChild);
}



// STATS BAR
function updateStats(trade) {
  state.stats.vol    += trade.amount;
  state.stats.trades += 1;
  if (trade.amount >= WHALE_THRESHOLD) state.stats.whales += 1;
  if (trade.side === 'BUY') { state.stats.buys++; state.stats.buyVol += trade.amount; }
  else                      { state.stats.sells++; state.stats.sellVol += trade.amount; }

  const total = state.stats.buys + state.stats.sells;
  const buyPct  = total > 0 ? Math.round(state.stats.buys  / total * 100) : 50;
  const sellPct = 100 - buyPct;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('stat-trades',   state.stats.trades.toLocaleString());
  setEl('stat-buy-vol',  fmtUSD(state.stats.buyVol));
  setEl('stat-sell-vol', fmtUSD(state.stats.sellVol));
  setEl('stat-whales',   state.stats.whales);
  setEl('stat-ratio',    state.stats.buys + '/' + state.stats.sells);
  setEl('stat-vol',      fmtUSD(state.stats.vol));
  // Mobile
  setEl('stat-trades-m',   state.stats.trades.toLocaleString());
  setEl('stat-buy-vol-m',  fmtUSD(state.stats.buyVol));
  setEl('stat-sell-vol-m', fmtUSD(state.stats.sellVol));
  setEl('stat-whales-m',   state.stats.whales);
}


// CLOCK

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    el.textContent = new Date().toUTCString().slice(17, 25) + ' UTC';
  };
  tick();
  setInterval(tick, 1000);
}


// TRADE PROCESSOR

function processTrade(trade) {
  addToFeed(trade);
  updateStats(trade);
  updateChart(trade.token, trade.side, trade.amount);
  updateLeaderboard(trade);
  if (trade.amount >= WHALE_THRESHOLD) addToWhale(trade);
}


// BACKEND WEBSOCKET
// Auto-reconnects if the backend drops mid-session.

const RECONNECT_INTERVAL = 3000;  // ms between reconnect attempts

function connectBackend() {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.log('⚠️ Backend unreachable');
      return;
    }

    ws.onopen = () => {
      console.log('✅ Connected to BAGS//FLOW backend');
      state.connected = true;
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'status') {
          // Server tells us if the Bitquery stream is live, connecting, or reconnecting
          const dot = document.querySelector('.live-dot');
          if (dot) {
            if (msg.stream === 'live')         dot.style.background = 'var(--green)';
            else if (msg.stream === 'reconnecting') dot.style.background = 'var(--red)';
            else                               dot.style.background = 'var(--gold)';
          }
          console.log(`📡 Stream status: ${msg.stream}`);
          return;
        }

        if (msg.type === 'trade') {
          const trade = { ...msg, time: new Date(msg.time) };
          // Register real token in chart if not already tracked
          if (trade.token && !chartTokens.includes(trade.token) && chartTokens.length < 12) {
            chartTokens.push(trade.token);
            buyData.push(0);
            sellData.push(0);
            state.chart.data.labels = chartTokens;
            state.chart.data.datasets[0].data = buyData;
            state.chart.data.datasets[1].data = sellData;
          }
          processTrade(trade);
        }

        if (msg.type === 'launch') {
          addLaunch({ ...msg, time: new Date(msg.time) });
        }

      } catch (e) {
        console.warn('WS parse error:', e);
      }
    };

    ws.onerror = () => {
      if (!state.connected) {
        console.log('⚠️  Backend unreachable — retrying…');
      }
    };

    ws.onclose = () => {
      if (state.connected) {
        console.log('⚠️  Backend disconnected — reconnecting…');
        state.connected = false;
      }
      // Always try to reconnect
      reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL);
    };
  }

  connect();
}

// BOTTOM PANELS 

const BACKEND_API = 'https://bagsflow-production.up.railway.app/api';

// Render session leaderboard (built from live WebSocket trades)
function renderSessionTraders(list) {
  const sorted = Object.values(state.leaderboard || {})
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 20);
  list.innerHTML = '';
  if (!sorted.length) {
    list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">Waiting for live trades…</div>';
    return;
  }
  sorted.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    row.innerHTML = `
      <span style="font-family:var(--font-mono);color:var(--gold);">${medal}</span>
      <span style="font-family:var(--font-mono);color:var(--muted);" title="${entry.wallet}">${entry.wallet.slice(0,4)}···${entry.wallet.slice(-4)}</span>
      <span style="font-family:var(--font-mono);color:var(--green);">${fmtUSD(entry.vol)}</span>
      <span style="font-family:var(--font-mono);color:var(--muted);">${entry.trades}</span>
    `;
    list.appendChild(row);
  });
}

let _traderTf = 'session';

function setTraderTimeframe(tf) {
  _traderTf = tf;
  document.querySelectorAll('.tf-btn').forEach(b => {
    const label = b.textContent.trim();
    b.classList.toggle('tf-active',
      (tf === 'session' && label === 'SESSION') ||
      (tf === '24h'     && label === '24H')     ||
      (tf === '7d'      && label === '7D')
    );
  });
  loadTopTraders();
}
window.setTraderTimeframe = setTraderTimeframe;

async function loadTopTraders() {
  const list = document.getElementById('traders-list');
  if (!list) return;

  // SESSION tab — use local leaderboard built from live trade stream
  if (_traderTf === 'session') {
    renderSessionTraders(list);
    return;
  }

  list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">Loading traders…</div>';
  try {
    const res  = await fetch(`${BACKEND_API}/analytics/top-traders?timeframe=${_traderTf}&limit=20`);
    const data = await res.json();
    const traders = (data.success && data.response) ? data.response : [];
    list.innerHTML = '';
    if (!traders.length) {
      list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">No data yet — check BIRDEYE_API_KEY in Railway</div>';
      return;
    }
    traders.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
      row.innerHTML = `
        <span style="font-family:var(--font-mono);color:var(--gold);">${medal}</span>
        <span style="font-family:var(--font-mono);color:var(--muted);" title="${t.wallet}">${t.wallet.slice(0,4)}···${t.wallet.slice(-4)}</span>
        <span style="font-family:var(--font-mono);color:var(--green);">${fmtUSD(t.volume)}</span>
        <span style="font-family:var(--font-mono);color:var(--muted);">${t.trades}</span>
      `;
      list.appendChild(row);
    });
  } catch(e) {
    list.innerHTML = `<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">Error: ${e.message}</div>`;
    console.error('loadTopTraders:', e);
  }
}

async function loadTopTokens() {
  const list = document.getElementById('top-tokens-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">Loading tokens…</div>';
  try {
    const res  = await fetch(`${BACKEND_API}/analytics/top-tokens?limit=10`);
    const data = await res.json();
    const tokens = (data.success && data.response) ? data.response : [];
    list.innerHTML = '';
    if (!tokens.length) {
      list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">No token data yet</div>';
      return;
    }
    tokens.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'top-token-row';
      row.onclick   = () => window.open(`https://solscan.io/token/${t.mint}`, '_blank');
      const chgColor = (t.priceChange24h || 0) >= 0 ? 'var(--green)' : 'var(--red)';
      const chgStr   = t.priceChange24h ? `${t.priceChange24h >= 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}%` : '—';
      row.innerHTML = `
        <span style="font-family:var(--font-mono);color:var(--muted);">${i + 1}</span>
        <span style="font-family:var(--font-mono);color:var(--cyan);font-weight:600;">$${t.symbol || t.mint.slice(0,6)}</span>
        <span style="font-family:var(--font-mono);color:var(--text);text-align:right;">${fmtUSD(t.marketCap)}</span>
        <span style="font-family:var(--font-mono);color:var(--muted);text-align:right;">${fmtPrice(t.price)}</span>
        <span style="font-family:var(--font-mono);color:${chgColor};text-align:right;">${chgStr}</span>
      `;
      list.appendChild(row);
    });
  } catch(e) {
    list.innerHTML = `<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">Error: ${e.message}</div>`;
    console.error('loadTopTokens:', e);
  }
}

// Track mints already shown so loadLaunches never wipes real-time entries
const _seenLaunchMints = new Set();

async function loadLaunches() {
  const list = document.getElementById('launch-list');
  if (!list) return;
  try {
    const res  = await fetch(`${BACKEND_API}/analytics/launches-with-mcap?limit=20`);
    const data = await res.json();
    const launches = (data.success && data.response) ? data.response : [];
    if (!launches.length) {
      // Only show placeholder if list is completely empty
      if (!list.children.length) {
        list.innerHTML = '<div style="padding:16px;font-size:10px;color:var(--muted);text-align:center;">No launches yet</div>';
      }
      return;
    }
    // Remove placeholder if present
    const placeholder = list.querySelector('div[style]');
    if (placeholder) placeholder.remove();

    // Add only new launches (don't wipe existing)
    launches.forEach(l => {
      const mint = l.mint || l.symbol;
      if (!mint || _seenLaunchMints.has(mint)) return;
      _seenLaunchMints.add(mint);

      const row    = document.createElement('div');
      row.className = 'launch-row';
      const symbol = l.symbol || l.name || '???';
      const mcap   = l.marketCap > 0 ? fmtUSD(l.marketCap) : '—';
      const price  = l.price     > 0 ? fmtPrice(l.price)   : '—';
      const chg    = (l.priceChange24h !== undefined && l.priceChange24h !== 0)
        ? `<span style="color:${l.priceChange24h >= 0 ? 'var(--green)' : 'var(--red)'};">${l.priceChange24h >= 0 ? '+' : ''}${l.priceChange24h.toFixed(1)}%</span>`
        : `<span style="color:var(--muted);">—</span>`;
      const link   = l.mint
        ? `<a href="https://solscan.io/token/${l.mint}" target="_blank" style="color:var(--cyan);font-weight:700;text-decoration:none;">$${symbol}</a>`
        : `<span style="color:var(--cyan);font-weight:700;">$${symbol}</span>`;
      row.innerHTML = `${link}<span style="font-family:var(--font-mono);color:var(--text);text-align:right;">${mcap}</span><span style="font-family:var(--font-mono);color:var(--muted);text-align:right;">${price}</span>${chg}`;
      list.prepend(row);
    });
    // Keep max 40 rows
    while (list.children.length > 40) list.removeChild(list.lastChild);
  } catch(e) {
    console.warn('loadLaunches:', e);
  }
}

function loadAllPanels() {
  loadTopTraders();
  loadTopTokens();
  loadLaunches();
}

setInterval(loadAllPanels, 120_000);

// THEME TOGGLE ─
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = isLight ? '🌙' : '☀';
  localStorage.setItem('bagsflow-theme', isLight ? 'light' : 'dark');
}
window.toggleTheme = toggleTheme;

function initTheme() {
  const saved = localStorage.getItem('bagsflow-theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '🌙';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initChart();
  startClock();
  connectBackend();
  setTimeout(loadAllPanels, 1500);
});