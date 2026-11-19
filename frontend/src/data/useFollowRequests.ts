import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

type FollowRequest = { user_id: string; display_name: string; handle: string; created_at: string };
type RequestPage = { items: FollowRequest[]; next_offset: number | null };
type Snapshot = RequestPage & { owner: string; error: string };

export function useFollowRequests(token: string | null, owner: string, enabled: boolean, reloadKey: number, onChanged: () => void) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sequence = useRef(0);
  const lifecycle = useRef(0);
  const mutation = useRef(false);
  const loadedRange = useRef({ owner: "", count: 0 });
  const visible = enabled && snapshot?.owner === owner ? snapshot : null;

  const refresh = useCallback(async () => {
    if (!token || !enabled || mutation.current) return;
    const request = ++sequence.current;
    try {
      const targetCount = loadedRange.current.owner === owner ? Math.max(1, loadedRange.current.count) : 1;
      let items: FollowRequest[] = [];
      let offset: number | null = 0;
      do {
        const path = offset === 0 ? "/api/me/follow-requests?limit=50" : `/api/me/follow-requests?limit=50&offset=${offset}`;
        const page: RequestPage = await api(path, token);
        if (request !== sequence.current) return;
        items = [...new Map([...items, ...page.items].map(item => [item.user_id, item])).values()];
        offset = page.next_offset;
      } while (offset !== null && items.length < targetCount);
      loadedRange.current = { owner, count: items.length };
      setSnapshot({ items, next_offset: offset, owner, error: "" });
    } catch (err) {
      if (request === sequence.current) setSnapshot(previous => ({ items: previous?.owner === owner ? previous.items : [], next_offset: previous?.owner === owner ? previous.next_offset : null, owner, error: err instanceof Error ? err.message : "Could not load follow requests." }));
    }
  }, [token, owner, enabled]);

  useEffect(() => {
    lifecycle.current += 1;
    const kickoff = window.setTimeout(() => void refresh(), 0);
    const check = () => { if (document.visibilityState === "visible" && !mutation.current) void refresh(); };
    const timer = enabled ? window.setInterval(check, 30000) : undefined;
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      sequence.current += 1;
      lifecycle.current += 1;
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refresh, enabled, reloadKey]);

  async function resolve(id: string, action: "approve" | "decline") {
    if (!token || !enabled || mutation.current) return;
    const current = lifecycle.current;
    mutation.current = true;
    setBusy(id);
    try {
      await api(`/api/me/follow-requests/${id}/${action}`, token, { method: "POST" });
      if (current !== lifecycle.current) return;
      sequence.current += 1;
      if (loadedRange.current.owner === owner) loadedRange.current.count = Math.max(0, loadedRange.current.count - 1);
      setSnapshot(previous => previous?.owner === owner ? { ...previous, items: previous.items.filter(item => item.user_id !== id), next_offset: previous.next_offset === null ? null : Math.max(0, previous.next_offset - 1), error: "" } : previous);
      onChanged();
    } catch (err) {
      if (current === lifecycle.current) setSnapshot(previous => previous?.owner === owner ? { ...previous, error: err instanceof Error ? err.message : "Could not update follow request." } : previous);
    } finally {
      mutation.current = false;
      setBusy(null);
    }
  }

  async function loadMore() {
    if (!token || !visible || visible.next_offset === null || loadingMore || mutation.current) return;
    const current = lifecycle.current;
    sequence.current += 1;
    mutation.current = true;
    setLoadingMore(true);
    try {
      const page = await api<RequestPage>(`/api/me/follow-requests?limit=50&offset=${visible.next_offset}`, token);
      if (current === lifecycle.current) {
        const items = [...new Map([...visible.items, ...page.items].map(item => [item.user_id, item])).values()];
        loadedRange.current = { owner, count: items.length };
        setSnapshot({ ...visible, items, next_offset: page.next_offset, error: "" });
      }
    } catch (err) {
      if (current === lifecycle.current) setSnapshot(previous => previous?.owner === owner ? { ...previous, error: err instanceof Error ? err.message : "Could not load more requests." } : previous);
    } finally { mutation.current = false; setLoadingMore(false); }
  }

  return { items: visible?.items ?? [], hasMore: visible?.next_offset != null, loading: enabled && !visible, error: visible?.error ?? "", busy, loadingMore, refresh, resolve, loadMore };
}
