/* OfferAIO licensing + quota, shared by popup.js and content.js.
 *
 * Loaded as a plain script before both, so it just hangs an object off the shared
 * isolated-world global rather than using ES modules (content scripts can't import).
 *
 * Three rules from PROJECT.md §10 that this file implements:
 *   - Cache the verify result ~24h. Nobody needs a network round trip per application.
 *   - Fail OPEN on a network error: if the Worker is unreachable but the key verified
 *     active recently, stay on Pro for up to 7 days. An outage on our side must not
 *     downgrade someone who paid.
 *   - Fail CLOSED on an explicit inactive: if the Worker says the licence is dead,
 *     believe it immediately.
 *
 * The submission counter lives in chrome.storage.local and is therefore trivially
 * resettable by a determined user. That's true of every client-side extension and is
 * why heavy auth isn't worth building — real enforcement is server-side metering on
 * /cover, where the cost actually is.
 */
(() => {
  const WORKER = "https://offeraio-worker.tobybergerbusiness.workers.dev";

  const FREE_QUOTA = 50;
  const PRO_QUOTA = 250;

  const CACHE_MS = 24 * 60 * 60 * 1000; // re-verify at most daily
  const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // ride out a Worker outage

  const FREE = { active: false, plan: "free", quota: FREE_QUOTA };

  const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
  const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

  /** Stable per-install id, so a key can be bound to a few browsers. */
  async function installId() {
    const d = await get(["installId"]);
    if (d.installId) return d.installId;
    const id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + Math.random().toString(16).slice(2);
    await set({ installId: id });
    return id;
  }

  const monthKey = (d = new Date()) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

  /** Usage for the current month, resetting automatically when the month rolls over. */
  async function getUsage() {
    const d = await get(["usage"]);
    const now = monthKey();
    const u = d.usage;
    if (!u || u.month !== now) return { month: now, count: 0 };
    return { month: now, count: u.count || 0 };
  }

  async function recordSubmission() {
    const u = await getUsage();
    const next = { month: u.month, count: u.count + 1 };
    await set({ usage: next });
    return next;
  }

  /**
   * Ask the Worker about a key. Resolves to null on any network/parse failure, which
   * the caller treats as "unknown", NOT as "inactive".
   */
  async function fetchVerdict(key, id) {
    try {
      const res = await fetch(WORKER + "/license/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, installId: id }),
      });
      if (!res.ok) return null;
      const j = await res.json();
      return j && j.ok ? j : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Current entitlement. `force` skips the 24h cache (used right after the user pastes
   * a key, where waiting a day for the truth would be absurd).
   */
  async function getLicense(opts = {}) {
    const d = await get(["license"]);
    const lic = d.license;
    if (!lic || !lic.key) return { ...FREE, reason: "no_key" };

    const now = Date.now();
    const cached = lic.cache;
    // `age >= 0` matters: a clock knocked forward and later corrected leaves checkedAt
    // in the future, and a bare `age < CACHE_MS` would call that fresh forever —
    // freezing whatever verdict was cached, in either direction.
    const age = now - (cached && cached.checkedAt ? cached.checkedAt : 0);
    const fresh = cached && age >= 0 && age < CACHE_MS;
    if (fresh && !opts.force) {
      return {
        active: !!cached.active,
        plan: cached.active ? "pro" : "free",
        quota: cached.active ? PRO_QUOTA : FREE_QUOTA,
        reason: cached.reason,
        cached: true,
      };
    }

    const verdict = await fetchVerdict(lic.key, await installId());

    if (!verdict) {
      // Couldn't reach the Worker. Trust the last known-good answer for a while
      // rather than punishing a paying user for our outage.
      //
      // `cached.active` is part of the test on purpose. Without it, someone whose
      // licence we already know is cancelled could block the Worker (hosts file, or
      // just wait for a 5xx) and coast on grace for another week, because
      // `lastActiveAt` still points at their last good check. Grace extends a
      // last-known-GOOD answer; it never resurrects a known-bad one.
      const lastGood = (cached && cached.active && cached.lastActiveAt) || 0;
      if (lastGood && now - lastGood < OFFLINE_GRACE_MS) {
        return { active: true, plan: "pro", quota: PRO_QUOTA, reason: "offline_grace", stale: true };
      }
      // No recent proof of Pro — fall back to Free, but leave the stored key alone so
      // it starts working again once the Worker is reachable.
      return { ...FREE, reason: "unreachable", stale: true };
    }

    const cache = {
      active: !!verdict.active,
      reason: verdict.reason,
      status: verdict.status,
      periodEnd: verdict.periodEnd,
      checkedAt: now,
      // Only advanced on a confirmed-active answer; this is what the offline grace
      // measures from.
      lastActiveAt: verdict.active ? now : (cached && cached.lastActiveAt) || 0,
    };
    await set({ license: { ...lic, cache } });

    return {
      active: cache.active,
      plan: cache.active ? "pro" : "free",
      quota: cache.active ? PRO_QUOTA : FREE_QUOTA,
      reason: cache.reason,
    };
  }

  /** Store and immediately validate a key the user pasted. */
  async function activate(rawKey) {
    const key = String(rawKey || "").trim();
    if (!key) return { ok: false, reason: "empty" };

    const id = await installId();
    let res;
    try {
      const r = await fetch(WORKER + "/license/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, installId: id }),
      });
      res = await r.json();
    } catch (e) {
      return { ok: false, reason: "unreachable" };
    }

    if (!res || !res.active) {
      return { ok: false, reason: (res && res.reason) || "invalid", maxInstalls: res && res.maxInstalls };
    }

    await set({
      license: {
        key: res.key || key,
        cache: {
          active: true,
          status: res.status,
          periodEnd: res.periodEnd,
          checkedAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      },
    });
    return { ok: true, plan: "pro", quota: PRO_QUOTA, installs: res.installs, maxInstalls: res.maxInstalls };
  }

  async function clearLicense() {
    await set({ license: null });
  }

  /** Combined view for the UI and the submit gate. */
  async function status() {
    const [lic, usage] = await Promise.all([getLicense(), getUsage()]);
    return {
      plan: lic.plan,
      active: lic.active,
      quota: lic.quota,
      used: usage.count,
      remaining: Math.max(0, lic.quota - usage.count),
      stale: !!lic.stale,
      reason: lic.reason,
    };
  }

  self.OfferAIOLicense = {
    getLicense,
    activate,
    clearLicense,
    getUsage,
    recordSubmission,
    status,
    installId,
    FREE_QUOTA,
    PRO_QUOTA,
  };
})();
