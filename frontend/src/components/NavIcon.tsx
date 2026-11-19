export default function NavIcon({ name }: { name: "discover" | "library" | "feed" | "profile" | "account" | "plus" }) {
  const paths = {
    discover: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    library: <><rect x="4" y="4" width="5" height="16" rx="1" /><path d="M12 4v16m4-15 4 14" /></>,
    feed: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8m-8 4h8m-8 4h4" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    account: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
