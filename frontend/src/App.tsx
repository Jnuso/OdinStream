import { useEffect, useState } from "react";
import {
  catalog,
  countryOptions,
  currentUserId,
  initialState,
  serviceOptions,
  users,
  type Post,
  type User,
  type SocialState,
} from "./data/mock";
import { readState, storageKey } from "./data/storage";
import Modal from "./components/Modal";
import Poster from "./components/Poster";
import PostComposer from "./components/PostComposer";
import { useNavigation } from "./data/navigation";
import "./App.css";

function Avatar({ user, large = false }: { user: User; large?: boolean }) {
  return (
    <span className={`avatar ${user.color} ${large ? "large-avatar" : ""}`}>
      {user.initials}
    </span>
  );
}
export default function App() {
  const [state, setState] = useState(readState);
  const { page, feed, profileId, navigate } = useNavigation();
  const setPage = (page: "feed" | "profile") =>
    navigate({ page, feed, profileId });
  const setFeed = (feed: "following" | "public") =>
    navigate({ page, feed, profileId });
  const [composer, setComposer] = useState<Post | "new" | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Post | null>(null);
  const [notice, setNotice] = useState("");
  const [persisted, setPersisted] = useState(true);
  const me = users.find((user) => user.id === currentUserId)!;
  const profile = users.find((user) => user.id === profileId)!;
  const title = catalog.find((item) => item.id === selectedTitle);
  const ownProfile = profileId === currentUserId;
  const posts = state.posts
    .filter((post) =>
      page === "profile"
        ? post.userId === profileId
        : feed === "public" || state.following.includes(post.userId),
    )
    .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  function updateState(update: (value: SocialState) => SocialState) {
    const next = update(state);
    setState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setPersisted(true);
    } catch {
      setPersisted(false);
    }
  }
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  function openProfile(id: string) {
    navigate({ page: "profile", feed, profileId: id });
  }
  function toggleFollow(id: string) {
    if (id === currentUserId) return;
    updateState((value) => ({
      ...value,
      following: value.following.includes(id)
        ? value.following.filter((item) => item !== id)
        : [...value.following, id],
    }));
  }
  function savePost(values: Pick<Post, "titleId" | "rating" | "review">) {
    if (!composer) return;
    if (composer === "new") {
      const post: Post = {
        ...values,
        id: crypto.randomUUID(),
        userId: currentUserId,
        createdAt: new Date().toISOString(),
      };
      updateState((value) => ({ ...value, posts: [post, ...value.posts] }));
      navigate({ page: "feed", feed: "public", profileId });
      setNotice("Your post is live in the local demo");
    } else {
      updateState((value) => ({
        ...value,
        posts: value.posts.map((post) =>
          post.id === composer.id && post.userId === currentUserId
            ? { ...post, ...values }
            : post,
        ),
      }));
      setNotice("Your post has been updated");
    }
    setComposer(null);
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
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage("feed");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
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
          Odin<span>Stream</span>
        </a>
        <div className="nav-label">Navigation</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${page === "feed" ? "active" : ""}`}
            aria-current={page === "feed" ? "page" : undefined}
            onClick={() => setPage("feed")}
          >
            <span aria-hidden="true">◉</span>Feed
          </button>
          <button
            className={`nav-item ${page === "profile" && ownProfile ? "active" : ""}`}
            aria-current={page === "profile" && ownProfile ? "page" : undefined}
            onClick={() => openProfile(currentUserId)}
          >
            <span aria-hidden="true">◎</span>My Profile
          </button>
        </nav>
        <button className="primary new-post" onClick={() => setComposer("new")}>
          <span>+</span> New post
        </button>
        <button
          className="demo-account"
          onClick={() => openProfile(currentUserId)}
        >
          <Avatar user={me} />
          <span>
            <strong>Raif Rashid</strong>
            <small>Demo account</small>
          </span>
          <span className="online" />
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Social prototype</span>
          <div>
            <span className="demo-badge">● MOCK DATA</span>
            <span className="country">{state.country}</span>
            <Avatar user={me} />
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {page === "feed" ? (
            <div className="page-heading">
              <div>
                <h1>Feed</h1>
                <p>Movie and show ratings and reviews.</p>
              </div>
            </div>
          ) : (
            <>
              <section
                className="profile-header"
                aria-label={`${profile.name} profile`}
              >
                <Avatar user={profile} large />
                <div className="profile-identity">
                  <span className="eyebrow">@{profile.handle}</span>
                  <h1>{profile.name}</h1>
                  <p>{profile.bio}</p>
                  <div className="profile-stats">
                    <span>
                      <strong>
                        {
                          state.posts.filter(
                            (post) => post.userId === profileId,
                          ).length
                        }
                      </strong>{" "}
                      Posts
                    </span>
                    {ownProfile ? (
                      <span>
                        <strong>{state.following.length}</strong> Following
                      </span>
                    ) : (
                      <span>
                        {state.following.includes(profileId)
                          ? "You follow this account"
                          : "Sample public profile"}
                      </span>
                    )}
                  </div>
                </div>
                {!ownProfile && (
                  <button
                    className={
                      state.following.includes(profileId)
                        ? "secondary"
                        : "primary"
                    }
                    onClick={() => toggleFollow(profileId)}
                  >
                    {state.following.includes(profileId)
                      ? "Unfollow"
                      : "+ Follow"}
                  </button>
                )}
              </section>
            </>
          )}
          <div className="social-layout">
            <div className="feed-column">
              {page === "feed" ? (
                <>
                  <section className="share-prompt">
                    <Avatar user={me} />
                    <button onClick={() => setComposer("new")}>
                      Write a review…
                    </button>
                    <button
                      className="prompt-plus"
                      aria-label="Create a new post"
                      onClick={() => setComposer("new")}
                    >
                      +
                    </button>
                  </section>
                  <div className="feed-tabs" aria-label="Feed selection">
                    <button
                      aria-pressed={feed === "following"}
                      className={feed === "following" ? "active" : ""}
                      onClick={() => setFeed("following")}
                    >
                      Following <span>{state.following.length}</span>
                    </button>
                    <button
                      aria-pressed={feed === "public"}
                      className={feed === "public" ? "active" : ""}
                      onClick={() => setFeed("public")}
                    >
                      Public
                    </button>
                  </div>
                </>
              ) : (
                <div className="section-heading">
                  <h2>
                    {ownProfile ? "Your" : `${profile.name.split(" ")[0]}’s`}{" "}
                    ratings & reviews
                  </h2>
                </div>
              )}
              <div className="post-list">
                {posts.map((post) => {
                  const author = users.find((user) => user.id === post.userId)!;
                  const movie = catalog.find(
                    (item) => item.id === post.titleId,
                  )!;
                  return (
                    <article
                      className="post-card"
                      key={post.id}
                      aria-label={`${author.name} on ${movie.name}`}
                    >
                      <div className="post-author">
                        <button
                          className="author-link"
                          onClick={() => openProfile(author.id)}
                        >
                          <Avatar user={author} />
                          <span>
                            <strong>{author.name}</strong>
                            <small>@{author.handle}</small>
                          </span>
                        </button>
                        <time dateTime={post.createdAt}>
                          {new Date(post.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" },
                          )}
                        </time>
                      </div>
                      <div className="post-content">
                        <button
                          className="poster-button"
                          aria-label={`Open ${movie.name} details`}
                          onClick={() => setSelectedTitle(movie.id)}
                        >
                          <Poster title={movie} />
                        </button>
                        <div className="post-review">
                          <span className="eyebrow">
                            {movie.kind} · {movie.year}
                          </span>
                          <button
                            className="title-link"
                            onClick={() => setSelectedTitle(movie.id)}
                          >
                            {movie.name} <span>↗</span>
                          </button>
                          <span
                            className="stars"
                            aria-label={`${post.rating} out of 5 stars`}
                          >
                            {"★".repeat(post.rating)}
                            <span>{"★".repeat(5 - post.rating)}</span>
                          </span>
                          {post.review ? (
                            <p className="review-text">{post.review}</p>
                          ) : (
                            <p className="muted review-text">
                              No written review.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="post-footer">
                        {post.userId === currentUserId ? (
                          <div>
                            <button onClick={() => setComposer(post)}>
                              Edit post
                            </button>
                            <button onClick={() => setDeleting(post)}>
                              Delete
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => openProfile(author.id)}>
                            View profile <span>→</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!posts.length && (
                <section className="empty">
                  <h2>
                    {page === "profile"
                      ? "No posts yet."
                      : "No posts from followed accounts."}
                  </h2>
                  <p>
                    {page === "profile"
                      ? "Ratings and reviews will appear here."
                      : "Follow someone to see their reviews, or explore the public feed."}
                  </p>
                  {page === "feed" ? (
                    <button
                      className="primary"
                      onClick={() => setFeed("public")}
                    >
                      Explore public feed →
                    </button>
                  ) : (
                    ownProfile && (
                      <button
                        className="primary"
                        onClick={() => setComposer("new")}
                      >
                        Write your first post →
                      </button>
                    )
                  )}
                </section>
              )}
            </div>
            <aside
              className="social-rail"
              aria-label="Community and preferences"
            >
              {page === "profile" && ownProfile && (
                <section className="rail-card preferences">
                  <h2>Preferences</h2>
                  <label htmlFor="country">Country</label>
                  <select
                    id="country"
                    value={state.country}
                    onChange={(event) =>
                      updateState((value) => ({
                        ...value,
                        country: event.target.value,
                      }))
                    }
                  >
                    {countryOptions.map((country) => (
                      <option key={country}>{country}</option>
                    ))}
                  </select>
                  <fieldset>
                    <legend>Your services</legend>
                    {serviceOptions.map((service) => (
                      <label className="service-check" key={service}>
                        <input
                          type="checkbox"
                          checked={state.services.includes(service)}
                          onChange={() =>
                            updateState((value) => ({
                              ...value,
                              services: value.services.includes(service)
                                ? value.services.filter(
                                    (item) => item !== service,
                                  )
                                : [...value.services, service],
                            }))
                          }
                        />
                        {service}
                      </label>
                    ))}
                  </fieldset>
                  <p className="muted small">
                    Saved locally. Live availability and recommendations will
                    connect later.
                  </p>
                </section>
              )}
              <section className="rail-card">
                <h2>Suggested accounts</h2>
                {users
                  .filter((user) => user.id !== currentUserId)
                  .map((user) => (
                    <div className="suggested-user" key={user.id}>
                      <button
                        className="author-link"
                        onClick={() => openProfile(user.id)}
                      >
                        <Avatar user={user} />
                        <span>
                          <strong>{user.name}</strong>
                          <small>@{user.handle}</small>
                        </span>
                      </button>
                      <button
                        className={`follow-button ${state.following.includes(user.id) ? "is-following" : ""}`}
                        aria-label={`${state.following.includes(user.id) ? "Unfollow" : "Follow"} ${user.name}`}
                        onClick={() => toggleFollow(user.id)}
                      >
                        {state.following.includes(user.id)
                          ? "Following"
                          : "+ Follow"}
                      </button>
                    </div>
                  ))}
                <p className="rail-footnote">Sample accounts.</p>
              </section>
              <p className="prototype-note">
                LOCAL FRONTEND PROTOTYPE
                <br />
                Sample accounts & reviews. No live social network.
              </p>
            </aside>
          </div>
          <footer>
            <span>
              <strong>OdinStream</strong>
            </span>
            <span>
              {persisted
                ? "Demo saved in this browser"
                : "Storage unavailable · session only"}
            </span>
            <button
              onClick={() => {
                updateState(() => initialState);
                setNotice("Social demo reset");
              }}
            >
              Reset demo
            </button>
          </footer>
        </main>
      </div>
      {composer && (
        <PostComposer
          post={composer === "new" ? undefined : composer}
          onClose={() => setComposer(null)}
          onSave={savePost}
        />
      )}
      {title && (
        <Modal label="Title details" onClose={() => setSelectedTitle(null)}>
          <div className="title-detail">
            <Poster title={title} />
            <div>
              <span className="eyebrow">
                {title.kind} · {title.year} · {title.genre}
              </span>
              <h2>{title.name}</h2>
              <p>{title.description}</p>
              <span className="muted small">
                Sample catalog detail. Live TMDB integration is future work.
              </span>
            </div>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal label="Delete post" onClose={() => setDeleting(null)}>
          <h2>Delete this post?</h2>
          <p className="muted">
            This removes it from your local demo profile and feed.
          </p>
          <div className="confirmation-actions">
            <button className="secondary" onClick={() => setDeleting(null)}>
              Keep post
            </button>
            <button
              className="primary"
              onClick={() => {
                updateState((value) => ({
                  ...value,
                  posts: value.posts.filter(
                    (post) =>
                      post.id !== deleting.id || post.userId !== currentUserId,
                  ),
                }));
                setDeleting(null);
                setNotice("Post deleted from the local demo");
              }}
            >
              Delete post
            </button>
          </div>
        </Modal>
      )}
      <div className={`toast ${notice ? "visible" : ""}`} role="status">
        {notice}
      </div>
    </>
  );
}
