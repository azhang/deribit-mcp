/**
 * Local-only live market cache.
 *
 * The hosted server can't keep anything between requests, so its tools subscribe, take
 * one snapshot and unsubscribe. A local server is a long-running process, so this keeps
 * channels subscribed after first use and answers later calls from memory. Each channel
 * is dropped after `idleTtlMs` without a request, so subscriptions last for a working
 * session, not forever, and the WebSocket closes once nothing is left. Everything also
 * ends when the stdio process exits.
 *
 * Same `snapshot(channels, { timeoutMs })` shape as the client, so tools don't care
 * which one they get.
 */
import { DeribitTransportError } from '@deribit-mcp/client';

function mergeChange(prev, change) {
  const out = { ...prev };
  for (const [key, value] of Object.entries(change)) {
    const old = prev[key];
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && old && typeof old === 'object' && !Array.isArray(old)
      ? { ...old, ...value }
      : value;
  }
  return out;
}

export class LiveMarket {
  /**
   * @param {import('@deribit-mcp/client').Deribit} client
   * @param {{ idleTtlMs?: number, maxChannels?: number, sweepMs?: number, now?: () => number }} [options]
   */
  constructor(client, { idleTtlMs = 15 * 60_000, maxChannels = 3000, sweepMs = 30_000, now = Date.now } = {}) {
    this.client = client;
    this.idleTtlMs = idleTtlMs;
    this.maxChannels = maxChannels;
    this.now = now;
    /** channel -> { data, lastUsed, waiters: Array<() => void> } */
    this.channels = new Map();
    this.listener = (data, channel) => this.#onData(data, channel);
    // A dropped socket makes cached data stale until the resubscribe delivers fresh snapshots.
    this.listener.onClose = () => {
      for (const entry of this.channels.values()) entry.data = undefined;
    };
    this.timer = setInterval(() => this.sweep(), sweepMs);
    this.timer.unref?.();
  }

  #onData(data, channel) {
    const entry = this.channels.get(channel);
    if (!entry) return;
    if (data?.type === 'change') {
      if (!entry.data) return; // wait for a full snapshot first
      entry.data = mergeChange(entry.data, data);
    } else {
      entry.data = data;
    }
    const waiters = entry.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  /**
   * Latest full data per channel. Already-live channels answer immediately; new ones are
   * subscribed (in one call) and kept. Refused channels are listed in `result.rejected`.
   */
  async snapshot(channelNames, { timeoutMs = 10_000 } = {}) {
    const list = [...new Set([].concat(channelNames))];
    const t = this.now();
    const fresh = list.filter((c) => !this.channels.has(c));
    for (const c of list) {
      const entry = this.channels.get(c) ?? { data: undefined, lastUsed: t, waiters: [] };
      entry.lastUsed = t;
      this.channels.set(c, entry);
    }

    let rejected = [];
    if (fresh.length) {
      try {
        const { rejected: refused } = await this.client.subscribe(fresh, this.listener);
        rejected = refused;
        for (const c of refused) this.channels.delete(c);
      } catch (error) {
        for (const c of fresh) this.channels.delete(c);
        throw error;
      }
    }

    const active = list.filter((c) => this.channels.has(c));
    const missing = active.filter((c) => this.channels.get(c).data === undefined);
    if (missing.length) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const still = missing.filter((c) => this.channels.get(c)?.data === undefined);
          reject(new DeribitTransportError('snapshot', `timed out waiting for ${still.length}/${active.length} channels (e.g. ${still.slice(0, 3).join(', ')})`));
        }, timeoutMs);
      });
      try {
        await Promise.race([
          Promise.all(missing.map((c) => new Promise((resolve) => {
            const entry = this.channels.get(c);
            if (!entry || entry.data !== undefined) resolve();
            else entry.waiters.push(resolve);
          }))),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
    }

    this.#evictOverflow();
    const result = Object.fromEntries(active.map((c) => [c, this.channels.get(c)?.data]));
    if (rejected.length) Object.defineProperty(result, 'rejected', { value: rejected, enumerable: false });
    return result;
  }

  /** Unsubscribe channels unused for idleTtlMs. Runs on a timer; callable directly. */
  async sweep() {
    const cutoff = this.now() - this.idleTtlMs;
    const idle = [...this.channels.entries()].filter(([, e]) => e.lastUsed < cutoff && e.waiters.length === 0).map(([c]) => c);
    await this.#drop(idle);
  }

  /** Keep at most maxChannels live, dropping the least recently used. */
  #evictOverflow() {
    const over = this.channels.size - this.maxChannels;
    if (over <= 0) return;
    const lru = [...this.channels.entries()].filter(([, e]) => e.waiters.length === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed).slice(0, over).map(([c]) => c);
    this.#drop(lru).catch(() => {});
  }

  async #drop(channels) {
    if (!channels.length) return;
    for (const c of channels) this.channels.delete(c);
    await this.client.unsubscribe(channels, this.listener).catch(() => {});
  }

  stats() {
    const t = this.now();
    const ages = [...this.channels.values()].map((e) => t - e.lastUsed);
    return { live_channels: this.channels.size, idle_ttl_minutes: this.idleTtlMs / 60_000, oldest_idle_seconds: ages.length ? Math.round(Math.max(...ages) / 1000) : 0 };
  }

  async close() {
    clearInterval(this.timer);
    await this.#drop([...this.channels.keys()]);
  }
}
