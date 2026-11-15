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
    // Check-and-count in ONE synchronous step, so many parallel requests cannot all
    // pass the check before any of them is counted. Returns seconds to wait when the
    // key is already at its limit (the attempt is refused); 0 when the attempt is
    // allowed and has been counted. Call refund() or reset() when it turns out fine.
    consume(key) {
      const e = live(key);
      if (e && e.count >= max) return Math.max(Math.ceil((e.first + windowMs - now()) / 1000), 1);
      if (e) e.count += 1;
      else hits.set(key, { count: 1, first: now() });
      if (hits.size > 10000) sweep();
      return 0;
    },
    // Give back one counted attempt (a successful login should not use up the allowance).
    refund(key) {
      const e = hits.get(key);
      if (!e) return;
      e.count -= 1;
      if (e.count <= 0) hits.delete(key);
    },
    reset(key) {
      hits.delete(key);
    }
  };
}

module.exports = { createLimiter };
