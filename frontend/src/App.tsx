import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { authCallbackError, supabase } from "./data/auth";
import { useNavigation, type Page } from "./data/navigation";
import {
  avatarColor,
  fetchMyProfile,
  fetchSuggestedProfiles,
  initials,
  setFollow,
  type MediaType,
  type Post,
  type Profile,
  type TitleSummary,
} from "./data/social";
import Account from "./components/Account";
import Setup from "./components/Setup";
import { AccountStatus } from "./components/AccountLayout";
import { api } from "./data/api";
import Discover from "./components/Discover";
import Feed from "./components/Feed";
import Library from "./components/Library";
import PostComposer from "./components/PostComposer";
import ProfileScreen from "./components/Profile";
import TitleDetails from "./components/TitleDetails";
import NavIcon from "./components/NavIcon";
import "./App.css";
import "./SiteRefinements.css";
import "./DesktopPrototype.css";
import "./RetroVideoStore.css";
import FollowRequests, { RequestBadge } from "./components/FollowRequests";
import { useFollowRequests } from "./data/useFollowRequests";

type Focus = { media_type: MediaType; id: number };

function SidebarProfile({ me, onOpen, requestCount, hasMore }: { me: Profile; onOpen: () => void; requestCount: number; hasMore: boolean }) {
  return (
    <button className="demo-account" onClick={onOpen} aria-label={`View your profile, ${me.display_name}`}>
      <span className={`avatar ${avatarColor(me.id)}`}>{initials(me.display_name)}</span>
      <span>
        <strong>{me.display_name}</strong>
        <small>@{me.handle}</small>
      </span>
      <RequestBadge count={requestCount} hasMore={hasMore} />
    </button>
  );
}

export default function App() {
  const [setup, setSetup] = useState<{ id: string; status: "checking" | "needed" | "ready" | "error" } | null>(null);
  const [setupRetry, setSetupRetry] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [recovery, setRecovery] = useState(false);
  const [authError, setAuthError] = useState<string | null>(authCallbackError);
  const [me, setMe] = useState<Profile | null>(null);
  const [suggested, setSuggested] = useState<Profile[]>([]);
  const [composer, setComposer] = useState<Post | "new" | null>(null);
  const [reviewTitle, setReviewTitle] = useState<TitleSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);
  const { page, feed, profileId, navigate } = useNavigation();
  const token = session?.access_token ?? null;
  const viewerId = session?.user.id ?? "";
  const viewingOwnProfile = page === "profile" && (profileId === "me" || profileId === viewerId);

  useEffect(() => {
    if (!supabase) return;
    if (authCallbackError) {
      window.history.replaceState(null, "", window.location.pathname + "#/account");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
        window.location.hash = "#/account";
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!token || !viewerId) { setSetup(null); return; }
    let active = true;
    setSetup({ id: viewerId, status: "checking" });
    api<{ setup_complete: boolean }>("/api/me/setup", token)
      .then(data => { if (active) setSetup({ id: viewerId, status: data.setup_complete ? "ready" : "needed" }); })
      .catch(() => { if (active) setSetup({ id: viewerId, status: "error" }); });
    return () => { active = false; };
  }, [token, viewerId, setupRetry]);

  useEffect(() => {
    if (!token || setup?.id !== viewerId || setup.status !== "ready") {
      setMe(null);
      setSuggested([]);
      return;
    }
    let active = true;
    fetchMyProfile(token).then((profile) => active && setMe(profile)).catch(() => active && setMe(null));
    fetchSuggestedProfiles(token).then((items) => active && setSuggested(items)).catch(() => active && setSuggested([]));
    return () => {
      active = false;
    };
  }, [token, reloadKey, setup, viewerId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const setPage = (next: Page) => navigate({ page: next, feed, profileId });
  const setFeed = (next: "following" | "public") => navigate({ page: "feed", feed: next, profileId });
  const openProfile = (id: string) => navigate({ page: "profile", feed, profileId: id });
  const openTitle = (mediaType: MediaType, id: number) => {
    setFocus({ media_type: mediaType, id });
  };
  const refresh = () => setReloadKey((value) => value + 1);
  const requests = useFollowRequests(token, viewerId, !!token && setup?.id === viewerId && setup.status === "ready", reloadKey, refresh);

  function startComposer() {
    setReviewTitle(null);
    if (!token) {
      navigate({ page: "account", feed, profileId });
      setNotice("Sign in to rate movies and shows.");
      return;
    }
    setComposer("new");
  }

  async function toggleFollow(profile: Profile) {
    if (!token) return;
    try {
      await setFollow(token, profile.id, !profile.viewer_follows);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The follow could not be saved.");
    }
  }

  const signInPrompt = (what: string) => (
    <section className="empty">
      <h2>Sign in to see {what}.</h2>
      <p>Feeds, profiles and your library are tied to an account.</p>
      <button className="primary" onClick={() => setPage("account")}>
        Go to Account
      </button>
    </section>
  );

  if (!authReady) return <AccountStatus />;

  if (token && !recovery) {
    if (setup?.id !== viewerId || setup.status === "checking") return <AccountStatus />;
    if (setup.status === "error") return <AccountStatus error
      onRetry={() => setSetupRetry(value => value + 1)}
      onSignOut={() => { void supabase?.auth.signOut(); }} />;
    if (setup.status === "needed") return <Setup token={token} onComplete={() => setSetup({ id: viewerId, status: "ready" })}
      onSignOut={() => { void supabase?.auth.signOut(); }} />;
  }

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#/discover"
          onClick={(event) => {
            event.preventDefault();
            setPage("discover");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            <span className="desktop-brand-letter">O</span>
            <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
              <path
                d="M6 18 18 6M6 6h12v12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Odin Stream</span>
        </a>
        <div className="nav-label">Navigation</div>
        <nav aria-label="Main navigation">
          <button className={`nav-item ${page === "discover" ? "active" : ""}`} aria-current={page === "discover" ? "page" : undefined} onClick={() => setPage("discover")}>
            <NavIcon name="discover" />Discover
          </button>
          <button className={`nav-item ${page === "library" ? "active" : ""}`} aria-current={page === "library" ? "page" : undefined} onClick={() => setPage("library")}>
            <NavIcon name="library" />My Library
          </button>
          <button className={`nav-item ${page === "feed" ? "active" : ""}`} aria-current={page === "feed" ? "page" : undefined} onClick={() => setPage("feed")}>
            <NavIcon name="feed" />Feed
          </button>
          <button
            className={`nav-item ${viewingOwnProfile ? "active" : ""}`}
            aria-current={viewingOwnProfile ? "page" : undefined}
            onClick={() => (token ? openProfile("me") : setPage("account"))}
          >
            <NavIcon name="profile" />My Profile <RequestBadge count={requests.items.length} hasMore={requests.hasMore} />
          </button>
          <button className={`nav-item ${page === "account" ? "active" : ""}`} aria-current={page === "account" ? "page" : undefined} onClick={() => setPage("account")}>
            <NavIcon name="account" />Account
          </button>
        </nav>
        <button className="primary new-post" onClick={startComposer}>
          <NavIcon name="plus" /> New post
        </button>
        {me ? <SidebarProfile me={me} onOpen={() => openProfile("me")} requestCount={requests.items.length} hasMore={requests.hasMore} /> : <p className="rail-footnote">Not signed in</p>}
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            {page === "discover" ? "Discover" : page === "library" ? "My Library" : page === "account" ? "Account" : page === "feed" ? "Feed" : "Profile"}
          </span>
          <div>
            <span className="country">United States</span>
            {page === "feed" && <button className="primary desktop-feed-compose" onClick={startComposer}>+ New post</button>}
            {token && <button className="mobile-account-shortcut" aria-label="Open account settings" onClick={() => setPage("account")}><NavIcon name="account" /></button>}
            <button className="account-shortcut" aria-label={token ? "View your profile" : "Sign in"} onClick={() => token ? openProfile("me") : setPage("account")}>
              {me ? <span className={`avatar ${avatarColor(me.id)}`}>{initials(me.display_name)}</span> : "Sign in"}
              <RequestBadge count={requests.items.length} hasMore={requests.hasMore} />
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {page === "discover" ? (
            <Discover token={token} onOpenTitle={openTitle} onOpenAccount={() => setPage("account")} />
          ) : page === "library" ? (
            <Library key={viewerId || "signed-out"} token={token} onOpenTitle={openTitle} />
          ) : page === "account" ? (
            <Account
              session={session}
              recovery={recovery}
              callbackError={authError}
              onClearCallbackError={() => setAuthError(null)}
              onRecoveryComplete={() => setRecovery(false)}
            />
          ) : page === "feed" ? (
            token ? (
              <div className="social-layout">
                <div className="feed-column">
                  <div className="page-heading">
                    <div>
                      <h1>Feed</h1>
                      <p>Movie and show ratings and reviews.</p>
                    </div>
                  </div>
                  <Feed
                    token={token}
                    viewerId={viewerId}
                    scope={feed}
                    onScope={setFeed}
                    onOpenProfile={openProfile}
                    onOpenTitle={openTitle}
                    onEdit={setComposer}
                    onNewPost={startComposer}
                    reloadKey={reloadKey}
                  />
                </div>
                <aside className="social-rail" aria-label="Suggested accounts">
                  <section className="rail-card">
                    <h2>Suggested accounts</h2>
                    {suggested.length === 0 && <p className="muted small">No other accounts yet.</p>}
                    {suggested.map((profile) => (
                      <div className="suggested-user" key={profile.id}>
                        <button className="author-link" onClick={() => openProfile(profile.id)}>
                          <span className={`avatar ${avatarColor(profile.id)}`}>{initials(profile.display_name)}</span>
                          <span>
                            <strong>{profile.display_name}</strong>
                            <small>@{profile.handle}</small>
                          </span>
                        </button>
                        <button
                          className={`follow-button ${profile.viewer_follows ? "is-following" : ""}`}
                          aria-label={`${profile.viewer_follows ? "Unfollow" : "Follow"} ${profile.display_name}`}
                          onClick={() => toggleFollow(profile)}
                        >
                          {profile.viewer_follows ? "Following" : "+ Follow"}
                        </button>
                      </div>
                    ))}
                  </section>
                </aside>
              </div>
            ) : (
              signInPrompt("the feed")
            )
          ) : token ? (
            <ProfileScreen
              token={token}
              viewerId={viewerId}
              profileId={profileId}
              reloadKey={reloadKey}
              onOpenProfile={openProfile}
              onOpenTitle={openTitle}
              onEdit={setComposer}
              onChanged={refresh}
              onOpenAccount={() => setPage("account")}
              followRequests={<FollowRequests model={requests} onOpenProfile={openProfile} />}
            />
          ) : (
            signInPrompt("your profile")
          )}
          <footer>
            <span>
              <strong>OdinStream</strong>
            </span>
            <span>Movie and TV data from TMDB. Availability provided by JustWatch.</span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {([ ["discover", "Discover"], ["library", "Library"], ["feed", "Feed"], ["profile", "Profile"] ] as const).map(([target, label]) => (
          <button key={target} aria-current={(target === "profile" ? viewingOwnProfile : page === target) ? "page" : undefined} onClick={() => target === "profile" ? (token ? openProfile("me") : setPage("account")) : setPage(target)}><NavIcon name={target} />{target === "profile" && <RequestBadge count={requests.items.length} hasMore={requests.hasMore} />}<span>{label}</span></button>
        ))}
        <button onClick={startComposer}><NavIcon name="plus" /><span>New post</span></button>
      </nav>
      {focus && <TitleDetails key={`${focus.media_type}:${focus.id}`} selection={focus} token={token} viewerId={viewerId} reloadKey={reloadKey} onClose={() => setFocus(null)} onReview={title => { setReviewTitle(title); setComposer("new"); }} onOpenProfile={openProfile} onEdit={setComposer} onOpenTitle={openTitle} />}
      {composer && token && (
        <PostComposer
          token={token}
          post={composer === "new" ? undefined : composer}
          initialTitle={reviewTitle}
          onClose={() => setComposer(null)}
          onSaved={(message) => {
            setComposer(null);
            setNotice(message);
            refresh();
          }}
        />
      )}
      <div className={`toast ${notice ? "visible" : ""}`} role="status">
        {notice}
      </div>
    </>
  );
}
