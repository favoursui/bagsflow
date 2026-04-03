import Chart from 'https://cdn.jsdelivr.net/npm/chart.js/auto/+esm';

/**
 * BAGS//FLOW — On-Chain Order Flow Dashboard
 * dashboard.js — All UI logic + Mock data engine
 *
 * Mock mode: streams realistic fake data until FastAPI backend is ready.
 * When backend is ready, set WS_URL to your server and it auto-switches.
 */


const WHALE_THRESHOLD  = 500;           // USD — trades above this are "whales"
const MAX_FEED_ROWS    = 80;            // max rows kept in live feed
const TRADE_INTERVAL   = 900;          // ms between mock trades
const WS_URL = 'wss://bagsflow-production.up.railway.app/ws';

// STATE

const state = {
  stats:       { vol: 0, trades: 0, whales: 0, buys: 0, sells: 0 },
  leaderboard: {},
  chart:       null,
  connected:   false,
};


// MOCK DATA ENGINE || initially for test purposes befor connecting to my backend

const TOKENS  = ['PEPE','BONK','WIF','MYRO','POPCAT','MOODENG','PNUT','GOAT'];
const NAMES   = ['DINO','CATZ','MOOSE','FLOKI2','MEOW','WAGMI','SNEK','PUPS','TURBO','ORCA'];

function rand(min, max)   { return Math.random() * (max - min) + min; }
function randInt(min, max){ return Math.floor(rand(min, max)); }
function pick(arr)        { return arr[randInt(0, arr.length)]; }

function mockWallet() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 44 }, () => chars[randInt(0, chars.length)]).join('');
}
function mockTx() {
  return Array.from({ length: 64 }, () => '0123456789abcdef'[randInt(0, 16)]).join('');
}

function mockTrade() {
  const isWhale = Math.random() < 0.09;
  return {
    id:     Date.now() + Math.random(),
    token:  pick(TOKENS),
    side:   Math.random() > 0.47 ? 'BUY' : 'SELL',
    amount: isWhale ? rand(500, 9000) : rand(8, 490),
    wallet: mockWallet(),
    tx:     mockTx(),
    time:   new Date(),
  };
}

function mockLaunch() {
  return {
    name:  pick(NAMES) + randInt(10, 999),
    price: rand(0.0000001, 0.001),
    mcap:  rand(3000, 200000),
    time:  new Date(),
  };
}

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


// MODULE 1 — LIVE TRADE FEED

function addToFeed(trade) {
  const list = document.getElementById('feed-list');
  const row  = document.createElement('div');
  row.className = 'feed-row new-row';

  const isBuy   = trade.side === 'BUY';
  const color   = isBuy ? 'var(--green)' : 'var(--red)';
  const symbol  = isBuy ? '▲' : '▼';
  const isWhale = trade.amount >= WHALE_THRESHOLD;

  row.innerHTML = `
    <span style="color:var(--cyan);font-weight:700;">${trade.token}</span>
    <span style="color:${color};">${symbol} ${trade.side}</span>
    <span style="color:${isWhale ? 'var(--gold)' : 'var(--text)'};">${fmtUSD(trade.amount)}</span>
    <span style="color:var(--muted);" title="${trade.wallet}">${fmtWallet(trade.wallet)}</span>
    <span style="color:var(--muted);">${fmtTime(trade.time)}</span>
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

  item.innerHTML = `
    <div class="whale-badge">🐋 WHALE</div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="color:var(--cyan);font-weight:700;">${trade.token}</span>
        <span style="color:${color};font-family:var(--font-mono);font-size:11px;">${trade.side}</span>
        <span style="color:var(--gold);font-family:var(--font-mono);font-weight:700;">${fmtUSD(trade.amount)}</span>
      </div>
      <div style="color:var(--muted);margin-top:2px;font-family:var(--font-mono);font-size:10px;">
        ${fmtWallet(trade.wallet)} · ${fmtTime(trade.time)}
      </div>
    </div>
    <a href="https://solscan.io/tx/${trade.tx}" target="_blank"
       style="color:var(--muted);font-family:var(--font-mono);font-size:9px;text-decoration:none;
              border:1px solid var(--border);padding:2px 6px;border-radius:3px;white-space:nowrap;"
       title="View on Solscan">↗ TX</a>
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
  const list = document.getElementById('launch-list');
  const row  = document.createElement('div');
  row.className = 'launch-row new-row launch-flash';
  row.innerHTML = `
    <span style="color:var(--cyan);font-weight:700;">$${launch.name}</span>
    <span style="font-family:var(--font-mono);color:var(--gold);">${fmtPrice(launch.price)}</span>
    <span style="font-family:var(--font-mono);color:var(--text);">${fmtUSD(launch.mcap)}</span>
    <span style="font-family:var(--font-mono);color:var(--muted);">${fmtTime(launch.time)}</span>
  `;
  list.prepend(row);
  while (list.children.length > 40) list.removeChild(list.lastChild);
}


// STATS BAR
function updateStats(trade) {
  state.stats.vol    += trade.amount;
  state.stats.trades += 1;
  if (trade.amount >= WHALE_THRESHOLD) state.stats.whales += 1;
  if (trade.side === 'BUY') state.stats.buys++;
  else state.stats.sells++;

  document.getElementById('stat-vol').textContent    = fmtUSD(state.stats.vol);
  document.getElementById('stat-trades').textContent = state.stats.trades.toLocaleString();
  document.getElementById('stat-whales').textContent = state.stats.whales;
  document.getElementById('stat-ratio').textContent  = state.stats.buys + '/' + state.stats.sells;
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


// TRADE PROCESSOR (shared by mock + backend)

function processTrade(trade) {
  addToFeed(trade);
  updateStats(trade);
  updateChart(trade.token, trade.side, trade.amount);
  updateLeaderboard(trade);
  if (trade.amount >= WHALE_THRESHOLD) addToWhale(trade);
}


// MOCK MODE (active until backend connects)

function startMockMode() {
  console.log('📊 Mock mode active — streaming fake data');

  // Pre-seed with initial data
  for (let i = 0; i < 20; i++) processTrade(mockTrade());
  for (let i = 0; i < 6; i++)  addLaunch(mockLaunch());
  renderLeaderboard();

  // Live trade stream
  setInterval(() => processTrade(mockTrade()), TRADE_INTERVAL);

  // New launch every 25–50 seconds
  const scheduleLaunch = () => {
    setTimeout(() => {
      addLaunch(mockLaunch());
      scheduleLaunch();
    }, rand(25_000, 50_000));
  };
  scheduleLaunch();
}


// BACKEND WEBSOCKET
// Auto-reconnects if the backend drops mid-session.
// Falls back to mock only if backend is unreachable on first attempt.

const RECONNECT_INTERVAL = 3000;  // ms between reconnect attempts

function connectBackend() {
  let ws = null;
  let mockStarted = false;
  let reconnectTimer = null;

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      if (!mockStarted) { mockStarted = true; startMockMode(); }
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
      if (!state.connected && !mockStarted) {
        console.log('ℹ️  Backend unreachable — running in mock mode');
        mockStarted = true;
        startMockMode();
      }
    };

    ws.onclose = () => {
      if (state.connected) {
        console.log('⚠️  Backend disconnected — reconnecting…');
        state.connected = false;
      }
      // Always try to reconnect (even if in mock mode, real backend may come up)
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