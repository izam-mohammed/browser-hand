// Blocked sites in the network stack (plans/06-settings.md, Decision 6):
// each blocked pattern becomes one declarativeNetRequest session rule that
// blocks `main_frame` and `sub_frame` requests in the tabs of browser-hand
// groups, so a link Claude clicks cannot load a blocked site, nor an iframe
// show one. The person's own tabs are never touched. Session rules end with
// the browser session, and the set is rewritten whole on every change
// (`docs/external/chrome-extension-apis.md` § chrome.declarativeNetRequest).
import { dnrRegex, isPattern } from "./sites";

export interface Rule {
  id: number;
  priority: number;
  action: { type: "block" };
  condition: { regexFilter: string; resourceTypes: ("main_frame" | "sub_frame")[]; tabIds: number[] };
}

export interface SiteRulesDeps {
  dnr: {
    getSessionRules(): Promise<{ id: number }[]>;
    updateSessionRules(o: { removeRuleIds?: number[]; addRules?: Rule[] }): Promise<void>;
  };
  /** Tab ids in every browser-hand group now. */
  groupTabs(): Promise<number[]>;
  /** The blocked patterns now. */
  blocked(): readonly string[];
}

/** One rule per pattern, for these tabs; none when there are no tabs (an
 * empty `tabIds` is not allowed). */
export function sessionRules(blocked: readonly string[], tabIds: readonly number[]): Rule[] {
  if (tabIds.length === 0) return [];
  return blocked.filter(isPattern).map((p, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "block" },
    condition: { regexFilter: dnrRegex(p), resourceTypes: ["main_frame", "sub_frame"], tabIds: [...tabIds].sort((a, b) => a - b) },
  }));
}

/** Keeps the session rules in step with the settings and the groups. */
export class SiteRuleSync {
  private chain: Promise<unknown> = Promise.resolve();
  private queued = false;

  constructor(private d: SiteRulesDeps) {}

  /** Rewrites the rules soon; calls made meanwhile share one rewrite. */
  update(): Promise<unknown> {
    if (this.queued) return this.chain;
    this.queued = true;
    this.chain = this.chain
      .then(async () => {
        this.queued = false;
        const rules = sessionRules(this.d.blocked(), await this.d.groupTabs());
        const old = (await this.d.dnr.getSessionRules()).map((r) => r.id);
        await this.d.dnr.updateSessionRules({ removeRuleIds: old, addRules: rules });
      })
      .catch((e) => {
        this.queued = false;
        console.warn("browser-hand: could not update the site rules", e);
      });
    return this.chain;
  }
}
