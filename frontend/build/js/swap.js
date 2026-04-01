/**
 * swap.js — Wallet Connection + Bags.fm Swap
 *
 * Supports: Phantom, Backpack, Solflare, Coinbase Wallet
 * Swap route: Frontend → FastAPI backend → Bags API → Solana
 */

import { VersionedTransaction } from 'https://esm.sh/@solana/web3.js@1.95.3';

// CONSTANTS

const SOL_MINT         = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;
const BACKEND = '/api'; // proxied by Nginx


// WALLET STATE

const wallet = {
  connected: false,
  publicKey: null,
  name:      null,
  provider:  null,
};

let detectedWallets = [];
let currentQuote    = null;
let currentToken    = null;   // { symbol, decimals } from token info
let quoteTimer      = null;


// WALLET DETECTION

function detectWallets() {
  const found = [];

  if (window.phantom?.solana?.isPhantom || window.solana?.isPhantom) {
    found.push({
      name: 'Phantom',
      icon: `<svg width="18" height="18" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" rx="24" fill="#AB9FF2"/><path d="M110.584 64.9142C110.584 49.778 99.4812 37.5 85.7596 37.5C78.6898 37.5 72.2654 40.5266 67.7182 45.4056C63.171 40.5266 56.7465 37.5 49.6768 37.5C35.9552 37.5 24.8521 49.778 24.8521 64.9142C24.8521 80.0504 35.9552 92.3284 49.6768 92.3284C53.6888 92.3284 57.468 91.2573 60.7716 89.3689L64.0001 91.2573L67.2287 89.3689C70.5323 91.2573 74.3115 92.3284 78.3235 92.3284C92.045 92.3284 110.584 80.0504 110.584 64.9142Z" fill="white"/><path d="M90.2415 55.8154C90.2415 53.0618 88.0227 50.8301 85.2846 50.8301H74.7249C71.9868 50.8301 69.768 53.0618 69.768 55.8154V73.1214C69.768 75.875 71.9868 78.1067 74.7249 78.1067H85.2846C88.0227 78.1067 90.2415 75.875 90.2415 73.1214V55.8154Z" fill="#AB9FF2"/><path d="M58.2321 55.8154C58.2321 53.0618 56.0133 50.8301 53.2752 50.8301H42.7155C39.9774 50.8301 37.7586 53.0618 37.7586 55.8154V73.1214C37.7586 75.875 39.9774 78.1067 42.7155 78.1067H53.2752C56.0133 78.1067 58.2321 75.875 58.2321 73.1214V55.8154Z" fill="#AB9FF2"/></svg>`,
      provider: window.phantom?.solana || window.solana,
    });
  }
  if (window.backpack?.isBackpack) {
    found.push({
      name: 'Backpack',
      icon: `<svg width="18" height="18" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="128" height="128" rx="24" fill="#E33E3F"/><path d="M83.5 38H44.5C41.4624 38 39 40.4624 39 43.5V84.5C39 87.5376 41.4624 90 44.5 90H83.5C86.5376 90 89 87.5376 89 84.5V43.5C89 40.4624 86.5376 38 83.5 38Z" fill="white"/><path d="M64 48C57.3726 48 52 53.3726 52 60V62H76V60C76 53.3726 70.6274 48 64 48Z" fill="#E33E3F"/><path d="M52 62H76V78H52V62Z" fill="#E33E3F"/><path d="M58 78H70V84H58V78Z" fill="#E33E3F"/><circle cx="64" cy="71" r="4" fill="white"/></svg>`,
      provider: window.backpack,
    });
  }
  if (window.solflare?.isSolflare) {
    found.push({
      name: 'Solflare',
      icon: `<svg width="18" height="18" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#FC7227"/><path d="M16 6l8 14H8L16 6z" fill="#fff" opacity=".9"/><path d="M16 26l-8-8h16l-8 8z" fill="#fff"/></svg>`,
      provider: window.solflare,
    });
  }
  if (window.coinbaseSolana) {
    found.push({
      name: 'Coinbase',
      icon: `<svg width="18" height="18" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#0052FF"/><circle cx="16" cy="16" r="8" fill="#fff"/><path d="M16 11a5 5 0 1 0 0 10A5 5 0 0 0 16 11zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="#0052FF"/></svg>`,
      provider: window.coinbaseSolana,
    });
  }

  return found;
}


// CONNECT / DISCONNECT

async function connectWalletByIndex(i) {
  const w = detectedWallets[i];
  if (!w) return;

  setStatus('connecting', `Connecting to ${w.name}…`);

  try {
    const resp   = await w.provider.connect();
    const pubkey = (resp?.publicKey ?? w.provider.publicKey)?.toString();
    if (!pubkey) throw new Error('No public key returned');

    wallet.connected = true;
    wallet.publicKey = pubkey;
    wallet.name      = w.name;
    wallet.provider  = w.provider;

    renderConnected();
    updateHeaderButton();
  } catch (err) {
    setStatus('error', err.message === 'User rejected the request.'
      ? 'Connection cancelled' : 'Connection failed');
  }
}

async function disconnectWallet() {
  try { await wallet.provider?.disconnect(); } catch (_) {}
  Object.assign(wallet, { connected: false, publicKey: null, name: null, provider: null });
  currentQuote = null;
  currentToken = null;
  renderDisconnected();
  updateHeaderButton();
}

// QUOTE


async function fetchQuote() {
  const ca      = document.getElementById('swap-ca').value.trim();
  const amount  = parseFloat(document.getElementById('swap-amount').value);
  const side    = document.getElementById('swap-side').dataset.side;
  const slipBps = parseInt(document.getElementById('swap-slippage').value * 100) || 50;

  if (!ca || ca.length < 32) return;
  if (!amount || amount <= 0) return;

  setStatus('loading', 'Validating token…');
  setQuoteBox('');

  try {
    // Step 1 — validate CA and get token info
    const tokenRes  = await fetch(`${BACKEND}/token/${ca}`);
    const tokenData = await tokenRes.json();

    if (!tokenData.success) {
      setStatus('error', 'Token not found on Bags.fm');
      return;
    }

    // Store token info (symbol + real decimals from on-chain)
    const pool = tokenData.response;
    currentToken = {
      symbol:   pool.symbol   || ca.slice(0, 6),
      decimals: pool.decimals ?? 9,
    };
    setStatus('loading', `${currentToken.symbol} found · fetching quote…`);

    // Step 2 — get quote using the simplified endpoint
    // On sell: pass token decimals so backend converts correctly
    const decimals  = currentToken.decimals ?? 9;
    const quoteRes  = await fetch(
      `${BACKEND}/token/${ca}/quote?amount=${amount}&side=${side}&slippageMode=manual&slippageBps=${slipBps}&decimals=${decimals}`
    );
    const quoteData = await quoteRes.json();

    if (!quoteData.success) throw new Error(quoteData.error || 'Quote failed');

    currentQuote = quoteData.response;
    renderQuote(currentQuote, side, currentToken);
    setStatus('ready', 'Quote ready — confirm to swap');
    document.getElementById('swap-exec-btn').disabled = false;

  } catch (err) {
    const msg = err.message || 'Unknown error';
    setStatus('error', msg);
    setQuoteBox('');
    console.warn('Quote error:', msg);
  }
}


function usdTag(usd) {
  return usd > 0
    ? `<span style="color:var(--muted);font-size:10px;margin-left:4px;">≈$${usd.toFixed(2)}</span>`
    : '';
}

function renderQuote(q, side, token = {}) {
  const solUsd     = window._solPriceUsd || 0;

  // Output decimals: buy → token decimals; sell → SOL (9)
  const outDec     = side === 'buy' ? (token.decimals ?? 9) : 9;
  const outAmt     = parseInt(q.outAmount || 0) / Math.pow(10, outDec);
  const minOutAmt  = parseInt(q.minOutAmount || 0) / Math.pow(10, outDec);

  // Input decimals: buy → SOL (9); sell → token decimals
  const inDec      = side === 'buy' ? 9 : (token.decimals ?? 9);
  const inAmt      = parseInt(q.inAmount || 0) / Math.pow(10, inDec);

  // USD values — SOL is always one side of the trade
  const solIn      = side === 'buy' ? inAmt  : 0;
  const solOut     = side === 'sell' ? outAmt : 0;
  const outUsd     = solOut > 0 ? solOut * solUsd       // sell: SOL received → USD
                   : solIn  > 0 ? solIn  * solUsd       // buy:  SOL spent ≈ USD value of tokens
                   : 0;
  const minOutUsd  = side === 'sell' ? minOutAmt * solUsd : 0;

  const outLabel   = side === 'buy' ? (token.symbol || 'TOKENS') : 'SOL';
  const impact     = parseFloat(q.priceImpactPct || 0).toFixed(3);
  const impColor   = impact > 5 ? 'var(--red)' : impact > 2 ? 'var(--gold)' : 'var(--green)';
  const venue      = q.routePlan?.[0]?.venue || 'Bags';

  const outFmt     = outAmt > 1e6    ? outAmt.toLocaleString(undefined, {maximumFractionDigits: 0})
                   : outAmt > 1      ? outAmt.toFixed(4)
                   : outAmt.toFixed(8);
  const minOutFmt  = minOutAmt > 1e6 ? minOutAmt.toLocaleString(undefined, {maximumFractionDigits: 0})
                   : minOutAmt > 1   ? minOutAmt.toFixed(4)
                   : minOutAmt.toFixed(8);

  setQuoteBox(`
    <div class="quote-row"><span>You receive</span><span style="color:var(--green);font-weight:700;">${outFmt} ${outLabel} ${usdTag(outUsd)}</span></div>
    <div class="quote-row"><span>Min received</span><span style="color:var(--text);">${minOutFmt} ${outLabel} ${usdTag(minOutUsd)}</span></div>
    <div class="quote-row"><span>Price impact</span><span style="color:${impColor};">${impact}%</span></div>
    <div class="quote-row"><span>Route</span><span style="color:var(--cyan);">${venue}</span></div>
  `);
}


// EXECUTE SWAP

async function executeSwap() {
  if (!wallet.connected) return setStatus('error', 'Connect your wallet first');
  if (!currentQuote)     return setStatus('error', 'Fetch a quote first');

  const btn = document.getElementById('swap-exec-btn');
  btn.disabled = true;
  setStatus('loading', 'Building transaction…');

  try {
    // 1. Build swap tx via backend
    const swapRes = await fetch(`${BACKEND}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: currentQuote, userPublicKey: wallet.publicKey }),
    });
    const swapData = await swapRes.json();
    if (!swapData.success) throw new Error(swapData.error || 'Failed to build transaction');

    // 2. Deserialize — handle both base64 and base64url encoding from Bags API
    const rawTx  = swapData.response.swapTransaction;
    if (!rawTx) throw new Error('insufficient_balance');
    // Normalise base64url → base64 (replace - with + and _ with /)
    const b64    = rawTx.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4 if needed
    const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
    let bytes, tx;
    try {
      bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
      tx    = VersionedTransaction.deserialize(bytes);
    } catch (_) {
      const side = document.getElementById('swap-side').dataset.side;
      throw new Error(side === 'sell' ? 'Insufficient token balance' : 'Insufficient SOL balance');
    }

    // 3. Sign
    setStatus('loading', 'Sign in your wallet…');
    const signed = await wallet.provider.signTransaction(tx);

    // 4. Send
    setStatus('loading', 'Sending transaction…');
    const sendRes = await fetch(`${BACKEND}/send-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: btoa(String.fromCharCode(...signed.serialize())),
        lastValidBlockHeight: swapData.response.lastValidBlockHeight,
      }),
    });
    const sendData = await sendRes.json();
    if (!sendData.success) throw new Error(sendData.error || 'Send failed');

    const sig = sendData.response.signature;
    setStatus('success', `Swapped! <a href="https://solscan.io/tx/${sig}" target="_blank" style="color:var(--cyan);text-decoration:underline;">View on Solscan ↗</a>`);

    // Reset
    currentQuote = null;
    setQuoteBox('');
    document.getElementById('swap-amount').value = '';

  } catch (err) {
    const raw = err.message || '';
    const msg = raw.includes('User rejected')          ? 'Signature cancelled'
              : raw.includes('buffer')                  ? 'Insufficient balance'
              : raw.includes('insufficient')            ? 'Insufficient balance'
              : raw.includes('0x1')                     ? 'Insufficient SOL balance'
              : raw.includes('atob')                    ? 'Insufficient token balance'
              : raw.includes('not correctly encoded')   ? 'Insufficient token balance'
              : raw.includes('0x1771')                  ? 'Insufficient token balance'
              : raw;
    setStatus('error', msg);
    btn.disabled = false;
  }
}


// UI HELPERS

function setStatus(type, html) {
  const el = document.getElementById('swap-status');
  if (!el) return;
  const colors = { loading:'var(--muted)', ready:'var(--green)', error:'var(--red)', success:'var(--green)', connecting:'var(--cyan)' };
  const icons  = { loading:'⟳', ready:'✓', error:'✕', success:'✓', connecting:'…' };
  el.style.color = colors[type] || 'var(--muted)';
  el.innerHTML   = `${icons[type] || ''} ${html}`;
}

function setQuoteBox(html) {
  const el = document.getElementById('swap-quote-box');
  if (el) el.innerHTML = html;
}

function renderConnected() {
  const area = document.getElementById('wallet-connect-area');
  area.innerHTML = `
    <div class="wallet-connected-row">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="wallet-dot"></div>
        <div>
          <div style="font-size:9px;color:var(--muted);letter-spacing:0.12em;">${wallet.name.toUpperCase()} · CONNECTED</div>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--cyan);">${wallet.publicKey.slice(0,6)}···${wallet.publicKey.slice(-6)}</div>
        </div>
      </div>
      <button class="btn-ghost-sm" onclick="disconnectWallet()">Disconnect</button>
    </div>
  `;
  document.getElementById('swap-form').style.display = 'flex';
  setStatus('ready', 'Ready to swap');
}

function renderDisconnected() {
  detectedWallets = detectWallets();
  const area = document.getElementById('wallet-connect-area');

  if (!detectedWallets.length) {
    area.innerHTML = `
      <div style="text-align:center;padding:16px 0;color:var(--muted);font-size:11px;line-height:1.7;">
        No Solana wallet detected.<br/>
        Install <a href="https://phantom.app" target="_blank" style="color:var(--cyan);">Phantom</a>,
        <a href="https://www.backpack.app" target="_blank" style="color:var(--cyan);">Backpack</a>, or
        <a href="https://solflare.com" target="_blank" style="color:var(--cyan);">Solflare</a>.
      </div>
    `;
  } else {
    area.innerHTML = `
      <div style="font-size:9px;color:var(--muted);letter-spacing:0.14em;margin-bottom:10px;">CONNECT WALLET</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${detectedWallets.map((w, i) => `
          <button class="wallet-option-btn" onclick="connectWalletByIndex(${i})">
            ${w.icon}
            <span>${w.name}</span>
            <span style="margin-left:auto;font-size:10px;color:var(--muted);">Detected ✓</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  const form = document.getElementById('swap-form');
  if (form) form.style.display = 'none';
}


// HEADER BUTTON

function updateHeaderButton() {
  const btn = document.getElementById('wallet-header-btn');
  if (!btn) return;
  if (wallet.connected) {
    btn.textContent = `${wallet.name}: ${wallet.publicKey.slice(0,4)}···${wallet.publicKey.slice(-4)}`;
    btn.classList.add('connected');
  } else {
    btn.textContent = 'Connect Wallet';
    btn.classList.remove('connected');
  }
}


// PANEL TOGGLE

function toggleSwapPanel() {
  const panel   = document.getElementById('swap-panel');
  const overlay = document.getElementById('swap-overlay');
  const isOpen  = panel.classList.toggle('open');
  overlay.style.display = isOpen ? 'block' : 'none';
  if (isOpen && !wallet.connected) renderDisconnected();
}


// SIDE TOGGLE (BUY / SELL)

function toggleSide() {
  const btn   = document.getElementById('swap-side');
  const side  = btn.dataset.side === 'buy' ? 'sell' : 'buy';
  btn.dataset.side = side;
  btn.textContent  = side === 'buy' ? '▲ BUY' : '▼ SELL';
  btn.className    = side === 'buy' ? 'side-btn buy' : 'side-btn sell';

  // Update amount label to reflect what unit the user is entering
  const lbl = document.getElementById('amount-label');
  if (lbl) lbl.textContent = side === 'buy' ? 'Amount (SOL)' : 'Amount (Tokens)';

  onInputChange();
}


// DEBOUNCED INPUT HANDLER

function onInputChange() {
  clearTimeout(quoteTimer);
  currentQuote = null;
  currentToken = null;
  document.getElementById('swap-exec-btn').disabled = true;
  setQuoteBox('');
  setStatus('ready', 'Enter amount to get quote');
  quoteTimer = setTimeout(fetchQuote, 700);
}


// EXPOSE TO HTML (onclick handlers)

window.toggleSwapPanel      = toggleSwapPanel;
window.toggleSide           = toggleSide;
window.connectWalletByIndex = connectWalletByIndex;
window.disconnectWallet     = disconnectWallet;
window.executeSwap          = executeSwap;
window.onInputChange        = onInputChange;


// INITIALIZE

async function fetchSolPrice() {
  try {
    const res  = await fetch(`${BACKEND}/sol-price`);
    const data = await res.json();
    if (data.success && data.price > 0) {
      window._solPriceUsd = data.price;
      console.log('[SOL price]', data.price);
    }
  } catch (e) {
    console.warn('SOL price fetch failed:', e.message);
    window._solPriceUsd = window._solPriceUsd || 0;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderDisconnected();
  fetchSolPrice();
  // Refresh SOL price every 60 seconds
  setInterval(fetchSolPrice, 60_000);
});