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
  const s = Math.floor((Date.now() - d) / 1000);
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
  row.className = 'feed-row' + (isWhale ? ' whale-row' : '');

  const totalStr = isWhale
    ? `<span style="color:var(--gold);font-weight:700;text-align:right;">${fmtUSD(trade.amount)}</span>`
    : `<span style="color:var(--text);text-align:right;">${fmtUSD(trade.amount)}</span>`;

  row.innerHTML = `
    <span style="color:var(--muted);">${fmtTime(trade.time)}</span>
    <span class="${isBuy ? 'side-buy' : 'side-sell'}">${isBuy ? '&#9650; BUY' : '&#9660; SELL'}</span>
    <span style="color:var(--cyan);font-weight:600;">$${trade.token}</span>
    <span style="color:var(--muted);" title="${trade.wallet}">${fmtWallet(trade.wallet)}</span>
    <span style="color:var(--text);text-align:right;">${fmtNum(trade.amount)}</span>
    <span style="color:var(--muted);text-align:right;">—</span>
    ${totalStr}
  `;

  list.prepend(row);
  while (list.children.length > MAX_FEED_ROWS) list.removeChild(list.lastChild);
  document.getElementById('feed-count').textContent = list.children.length + ' trades';
}



// MODULE 2 — WHALE ALERTS

function addToWhale(trade) {
  const list   = document.getElementById('whale-list');
  const item   = document.createElement('div');
  item.className = 'whale-item';
  const isBuy  = trade.side === 'BUY';
  const arrow  = isBuy ? '▲' : '▼';
  const cls    = isBuy ? 'whale-dir-up' : 'whale-dir-down';

  item.innerHTML = `
    <span class="${cls}">${arrow}</span>
    <span class="whale-token">$${trade.token}</span>
    <span class="whale-meta" style="flex:1;padding:0 8px;" title="${trade.wallet}">${fmtWallet(trade.wallet)}</span>
    <span class="whale-amt">${fmtUSD(trade.amount)}</span>
    <span class="whale-meta" style="margin-left:8px;">${fmtTime(trade.time)}</span>
  `;

  list.prepend(item);
  while (list.children.length > 20) list.removeChild(list.lastChild);
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

  // Refresh display every 5 trades (not every trade — cheaper)
  lbTimer++;
  if (lbTimer % 5 === 0) renderLeaderboard();
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
  const row    = document.createElement('div');
  row.className = 'launch-row';
  const symbol = launch.symbol || launch.name || '???';
  const age    = launch.time ? fmtAge(new Date(launch.time)) : '—';
  const mcap   = launch.mcap   > 0 ? fmtUSD(launch.mcap)   : '—';
  const vol    = launch.volume > 0 ? fmtUSD(launch.volume)  : '—';
  const link   = launch.mint
    ? `<a href="https://solscan.io/token/${launch.mint}" target="_blank" style="color:var(--cyan);font-weight:600;text-decoration:none;">$${symbol}</a>`
    : `<span style="color:var(--cyan);font-weight:600;">$${symbol}</span>`;
  row.innerHTML = `${link}<span style="color:var(--muted);text-align:right;">${age}</span><span style="color:var(--text);text-align:right;">${mcap}</span><span style="color:var(--green);text-align:right;">${vol}</span>`;
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

  document.getElementById('stat-trades').textContent  = state.stats.trades.toLocaleString();
  document.getElementById('stat-buy-vol').textContent  = fmtUSD(state.stats.buyVol);
  document.getElementById('stat-sell-vol').textContent = fmtUSD(state.stats.sellVol);
  document.getElementById('stat-buy-pct').textContent  = buyPct + '%';
  document.getElementById('stat-sell-pct').textContent = sellPct + '%';
  document.getElementById('stat-whales').textContent   = state.stats.whales;
  const fill = document.getElementById('ratio-fill');
  if (fill) fill.style.width = buyPct + '%';

  // Rate (trades per min)
  if (!state.stats.startTime) state.stats.startTime = Date.now();
  const mins = (Date.now() - state.stats.startTime) / 60000;
  const rate = mins > 0 ? Math.round(state.stats.trades / mins) : 0;
  document.getElementById('stat-rate').textContent = rate + '/min';

  // Mobile stats
  const mt = document.getElementById('stat-trades-m');
  const mb = document.getElementById('stat-buy-vol-m');
  const ms = document.getElementById('stat-sell-vol-m');
  const mw = document.getElementById('stat-whales-m');
  if (mt) mt.textContent = state.stats.trades.toLocaleString();
  if (mb) mb.textContent = fmtUSD(state.stats.buyVol);
  if (ms) ms.textContent = fmtUSD(state.stats.sellVol);
  if (mw) mw.textContent = state.stats.whales;
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


// INITIALIZE

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  startClock();
  connectBackend();
});