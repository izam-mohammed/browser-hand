// `read_network_requests`: a per-tab log from chrome.webRequest, cleared when
// the tab's top page moves to another host (plans/02-page-tools.md,
// decision 3). No bodies, no headers.

export const MAX_PER_TAB = 500;

export interface RequestEntry {
  requestId: string;
  url: string;
  method: string;
  type: string;
  start: number;
  status?: number;
  durationMs?: number;
  error?: string;
}

const SECRET_KEY = /token|key|secret|sig|password|auth|code|session/i;

/** A request URL with credentials hidden (plans/13-chrome-parity.md,
 * decision 1): userinfo, and the value of any query or fragment key whose
 * name looks like a secret. Done on the text, so the rest of the URL is
 * kept as it came. Redacted once when the request starts; the real value is
 * never kept. */
export function redactUrl(url: string): string {
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, "$1REDACTED@")
    .replace(/([?&#;])([^=&#;]*)=([^&#;]*)/g, (m, sep: string, key: string) =>
      SECRET_KEY.test(key) ? `${sep}${key}=REDACTED` : m,
    );
}

type Started = {
  requestId: string;
  tabId: number;
  url: string;
  method: string;
  type: string;
  timeStamp: number;
};
type Finished = { requestId: string; tabId: number; statusCode?: number; timeStamp: number };
type Failed = { requestId: string; tabId: number; error: string; timeStamp: number };

export class NetworkLog {
  private byTab = new Map<number, RequestEntry[]>();
  private hostOf = new Map<number, string>();

  started(d: Started) {
    if (d.tabId < 0) return;
    if (d.type === "main_frame") {
      let host = "";
      try {
        host = new URL(d.url).host;
      } catch {
        // keep the log
      }
      if (this.hostOf.get(d.tabId) !== host) this.byTab.delete(d.tabId);
      this.hostOf.set(d.tabId, host);
    }
    const list = this.byTab.get(d.tabId) ?? [];
    list.push({
      requestId: d.requestId,
      url: redactUrl(d.url),
      method: d.method,
      type: d.type,
      start: d.timeStamp,
    });
    if (list.length > MAX_PER_TAB) list.shift();
    this.byTab.set(d.tabId, list);
  }

  private entry(tabId: number, requestId: string) {
    return this.byTab.get(tabId)?.findLast((e) => e.requestId === requestId);
  }

  finished(d: Finished) {
    const e = this.entry(d.tabId, d.requestId);
    if (e) {
      e.status = d.statusCode;
      e.durationMs = Math.round(d.timeStamp - e.start);
    }
  }

  failed(d: Failed) {
    const e = this.entry(d.tabId, d.requestId);
    if (e) {
      e.error = d.error;
      e.durationMs = Math.round(d.timeStamp - e.start);
    }
  }

  forget(tabId: number) {
    this.byTab.delete(tabId);
    this.hostOf.delete(tabId);
  }

  read(tabId: number, opts: { urlPattern?: string; limit?: number; clear?: boolean }): string {
    const all = this.byTab.get(tabId) ?? [];
    const found = opts.urlPattern ? all.filter((e) => e.url.includes(opts.urlPattern!)) : all;
    const shown = found.slice(-(opts.limit ?? 100));
    if (opts.clear) this.byTab.delete(tabId);
    if (!shown.length)
      return "No network requests recorded for this tab (since its last cross-domain navigation).";
    const lines = shown.map((e) => {
      const outcome = e.error
        ? `failed ${e.error}`
        : e.status !== undefined
          ? String(e.status)
          : "pending";
      const time = e.durationMs !== undefined ? ` ${e.durationMs} ms` : "";
      return `${e.method} ${e.url} [${e.type}] ${outcome}${time}`;
    });
    if (found.length > shown.length)
      lines.unshift(`(${found.length} requests; showing the last ${shown.length})`);
    return lines.join("\n");
  }

  /** Wires the log to chrome.webRequest. */
  attach(webRequest: typeof chrome.webRequest, tabs: typeof chrome.tabs) {
    const filter = { urls: ["<all_urls>"] };
    webRequest.onBeforeRequest.addListener((d) => void this.started(d as Started), filter);
    webRequest.onCompleted.addListener((d) => void this.finished(d as Finished), filter);
    webRequest.onErrorOccurred.addListener((d) => void this.failed(d as Failed), filter);
    tabs.onRemoved.addListener((tabId) => this.forget(tabId));
  }
}
