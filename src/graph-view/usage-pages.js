// @ts-check
/** @typedef {import('../run-store.js').UsageRecord} UsageRecord */
/** @template T @typedef {{ reports: T[], cursor: number, opened: boolean, loading: boolean, hasMore: boolean, error: string | null }} PageState */

/** Browsing state survives snapshot redraws and requests finishing after a run switch. */
/** @template T */
export class CursorPages {
  /** @type {Map<string, PageState<T>>} */
  runs = new Map();
  /** @param {string} id */
  get(id) {
    let page = this.runs.get(id);
    if (!page) {
      page = { reports: [], cursor: 0, opened: false, loading: false, hasMore: false, error: null };
      this.runs.set(id, page);
    }
    return page;
  }
  /**
   * @param {string} id
   * @param {(id: string, cursor: number) => Promise<{reports: T[], nextAfter: number, hasMore: boolean}>} fetchPage
   */
  async load(id, fetchPage) {
    const page = this.get(id);
    if (page.loading) return;
    page.loading = true;
    page.error = null;
    try {
      const result = await fetchPage(id, page.cursor);
      page.reports.push(...result.reports);
      page.cursor = result.nextAfter;
      page.hasMore = result.hasMore;
      page.opened = true;
    } catch (error) {
      page.error = error instanceof Error ? error.message : String(error);
    } finally { page.loading = false; }
  }
}
/** @extends {CursorPages<UsageRecord>} */
export class UsagePages extends CursorPages {}
/** @extends {CursorPages<import('../run-store.js').TransitionRecord>} */
export class TracePages extends CursorPages {}
/** @extends {CursorPages<import('../retry-policy.js').RetryRecord>} */
export class RetryPages extends CursorPages {}
/** @typedef {ReturnType<import('../run-store.js').RunStore['collections']>} CollectionPage */
/** @extends {CursorPages<CollectionPage['records'][number]>} */
export class CollectionPages extends CursorPages {
  /** @type {Map<string, CollectionPage['summary']>} */
  summaries = new Map();
  /** @param {string} id @param {(id: string, cursor: number) => Promise<CollectionPage>} fetchPage */
  async loadCollection(id, fetchPage) {
    await this.load(id, async (key, cursor) => {
      const result = await fetchPage(key, cursor);
      this.summaries.set(key, result.summary);
      return { reports: result.records, nextAfter: result.nextAfter, hasMore: result.hasMore };
    });
  }
}
/** @typedef {ReturnType<typeof import('../service.js').publicAttempts>} AttemptPage */
/** @extends {CursorPages<AttemptPage['current']>} */
export class AttemptPages extends CursorPages {
  /** @type {Map<string, AttemptPage>} */
  snapshots = new Map();
  /** @param {string} id @param {(id: string, cursor: number) => Promise<AttemptPage>} fetchPage */
  async loadAttempts(id, fetchPage) {
    await this.load(id, async (key, cursor) => {
      const result = await fetchPage(key,cursor);
      this.snapshots.set(key,result);
      return { reports:result.records, nextAfter:result.nextAfter, hasMore:result.hasMore };
    });
  }
}
