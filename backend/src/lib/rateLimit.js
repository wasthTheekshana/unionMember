// Small in-memory failure limiter (fixed window). One Node process serves this
// app, so no shared store is needed. Used to slow down password guessing.
function createLimiter({ windowMs = 15 * 60 * 1000, max = 5, now = () => Date.now() } = {}) {
  const hits = new Map(); // key -> { count, first }

  function live(key) {
    const e = hits.get(key);
    if (e && now() - e.first >= windowMs) {
      hits.delete(key);
      return null;
    }
    return e || null;
  }

  function sweep() {
    for (const k of [...hits.keys()]) live(k);
  }

  return {
    // Seconds until the key may try again; 0 when it is not blocked.
    retryAfter(key) {
      const e = live(key);
      return e && e.count >= max ? Math.max(Math.ceil((e.first + windowMs - now()) / 1000), 1) : 0;
    },
    fail(key) {
      const e = live(key);
      if (e) e.count += 1;
      else hits.set(key, { count: 1, first: now() });
      if (hits.size > 10000) sweep();
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

module.exports = { createLimiter };
