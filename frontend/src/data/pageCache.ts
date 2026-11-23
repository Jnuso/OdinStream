const FRESH_MS = 30_000;

export function createPageCache<T>(fetchPage: () => Promise<T>) {
  let snapshot: { page: T; fetchedAt: number } | undefined;
  let pending: Promise<T> | undefined;

  return {
    peek: () => snapshot?.page,
    load(): Promise<T> {
      if (snapshot && Date.now() - snapshot.fetchedAt < FRESH_MS) return Promise.resolve(snapshot.page);
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
  };
}
