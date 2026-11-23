const FRESH_MS = 30_000;

export function createPageCache<T>(fetchPage: () => Promise<T>) {
  let snapshot: { page: T; fetchedAt: number } | undefined;
  let pending: Promise<T> | undefined;
  const peekFresh = () => snapshot && Date.now() - snapshot.fetchedAt < FRESH_MS ? snapshot.page : undefined;

  return {
    peek: () => snapshot?.page,
    peekFresh,
    load(): Promise<T> {
      const fresh = peekFresh();
      if (fresh !== undefined) return Promise.resolve(fresh);
      if (pending) return pending;
      const request = fetchPage()
        .then(page => {
          if (pending === request) snapshot = { page, fetchedAt: Date.now() };
          return page;
        })
        .finally(() => {
          if (pending === request) pending = undefined;
        });
      pending = request;
      return request;
    },
    invalidate() {
      snapshot = undefined;
      pending = undefined;
    },
    store(page: T) {
      pending = undefined;
      snapshot = { page, fetchedAt: Date.now() };
    },
  };
}
