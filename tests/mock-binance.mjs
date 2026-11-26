// Binance palsu & deterministik untuk tes (tanpa internet).
export function installMock() {
  const real = globalThis.fetch;
  const klines = (n, step, base) => Array.from({ length: n }, (_, i) => { const t = 1.7948e12 + i * step, p = base * (1 + Math.sin(i / 7) * .004); return [t, p, p * 1.002, p * .998, p, 1000 + (i % 5) * 50]; });
  globalThis.fetch = async (url, opt) => {
    const u = String(url);
    if (!u.includes('binance')) return real(url, opt);
    const j = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.includes('ticker/24hr')) return j(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LINK', 'AVAX', 'DOT', 'LTC', 'BCH', 'NEAR', 'APT', 'ARB', 'OP', 'INJ'].map((s, i) => ({ symbol: s + 'USDT', quoteVolume: String(1e9 - i * 1e7) })));
    if (u.includes('ticker/price')) return j([{ symbol: 'HBARUSDT', price: '0.0539' }, { symbol: 'BTCUSDT', price: '60000' }]);
    const m = u.match(/klines\?symbol=(\w+)&interval=(\w+)&limit=(\d+)/);
    if (m) { const step = { '15m': 9e5, '1h': 36e5, '1d': 864e5 }[m[2]] ?? 9e5; return j(klines(+m[3], step, m[1] === 'HBARUSDT' ? 0.0539 : 100)); }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return () => { globalThis.fetch = real; };
}
