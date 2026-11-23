import { useEffect, useState } from "react";
import { api } from "../data/api";
import { avatarColor, initials } from "../data/social";
import Modal from "./Modal";

export type ConnectionDirection = "followers" | "following";

type Account = { user_id: string; display_name: string; handle: string };
type ConnectionPage = { items: Account[]; next_offset: number | null };

export default function ProfileConnections({ token, profileId, direction, onClose, onOpenProfile }: {
  token: string;
  profileId: string;
  direction: ConnectionDirection;
  onClose: () => void;
  onOpenProfile: (id: string) => void;
}) {
  const label = direction === "followers" ? "Followers" : "Following";
  const [request, setRequest] = useState({ offset: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api<ConnectionPage>(
      `/api/profiles/${profileId}/connections/${direction}?offset=${request.offset}`, token,
    ).then((page) => {
      if (!active) return;
      setAccounts((previous) => {
        const ids = new Set(previous.map((account) => account.user_id));
        return [...previous, ...page.items.filter((account) => !ids.has(account.user_id))];
      });
      setNextOffset(page.next_offset);
    }).catch((err) => {
      if (active) setError(err instanceof Error ? err.message : "Could not load these accounts.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [direction, profileId, request, token]);

  function load(offset: number) {
    setError("");
    setLoading(true);
    setRequest({ offset });
  }

  return (
    <Modal label={label} onClose={onClose} className="profile-connections">
      <h2>{label}</h2>
      {accounts.length > 0 && (
        <ul className="profile-connections-list">
          {accounts.map((account) => (
            <li key={account.user_id}>
              <button className="author-link" type="button" onClick={() => onOpenProfile(account.user_id)}>
                <span className={`avatar ${avatarColor(account.user_id)}`} aria-hidden="true">
                  {initials(account.display_name)}
                </span>
                <span><strong>{account.display_name}</strong><small>@{account.handle}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loading && <p role="status">Loading accounts…</p>}
      {!loading && !error && accounts.length === 0 && (
        <p>{direction === "followers" ? "No followers yet." : "This profile isn’t following anyone yet."}</p>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button className="secondary" type="button" onClick={() => load(request.offset)}>Try again</button>
        </>
      )}
      {!loading && !error && nextOffset !== null && (
        <button className="secondary" type="button" onClick={() => load(nextOffset)}>Load more</button>
      )}
    </Modal>
  );
}
