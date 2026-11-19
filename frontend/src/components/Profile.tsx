import { useEffect, useState, type FormEvent } from "react";
import {
  avatarColor,
  fetchProfile,
  fetchProfilePosts,
  initials,
  saveProfile,
  setFollow,
  type Post,
  type Profile as ProfileData,
} from "../data/social";
import PostList from "./PostList";

export default function Profile({
  token,
  viewerId,
  profileId,
  reloadKey,
  onOpenProfile,
  onOpenTitle,
  onEdit,
  onChanged,
  onOpenAccount,
}: {
  token: string;
  viewerId: string;
  profileId: string;
  reloadKey: number;
  onOpenProfile: (id: string) => void;
  onOpenTitle: (mediaType: Post["media_type"], tmdbId: number) => void;
  onEdit: (post: Post) => void;
  onChanged: () => void;
  onOpenAccount: () => void;
}) {
  const target = profileId === "me" ? viewerId : profileId;
  const isSelf = target === viewerId;
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setPosts(null);
    setError("");
    Promise.all([fetchProfile(token, target), fetchProfilePosts(token, target)])
      .then(([data, items]) => {
        if (!active) return;
        setProfile(data);
        setPosts(items);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "The profile could not be loaded."));
    return () => {
      active = false;
    };
  }, [token, target, attempt, reloadKey]);

  async function toggleFollow() {
    if (!profile) return;
    setFollowBusy(true);
    setError("");
    try {
      await setFollow(token, profile.id, !profile.viewer_follows);
      setAttempt((value) => value + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The follow could not be saved.");
    } finally {
      setFollowBusy(false);
    }
  }

  if (error) {
    return (
      <section className="empty">
        <h2>This profile is unavailable.</h2>
        <p>{error}</p>
        <button className="primary" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  }
  if (!profile || posts === null) return <p role="status">Loading profile…</p>;

  return (
    <>
      <section className="profile-header" aria-label={`${profile.display_name} profile`}>
        <span className={`avatar ${avatarColor(profile.id)} large-avatar`}>
          {initials(profile.display_name)}
        </span>
        <div className="profile-identity">
          <span className="eyebrow">@{profile.handle}</span>
          <h1>{profile.display_name}</h1>
          <p>{profile.bio || (isSelf ? "Add a short bio from your profile settings." : "No bio yet.")}</p>
          <div className="profile-stats">
            <span>
              <strong>{profile.post_count}</strong> Posts
            </span>
            <span>
              <strong>{profile.follower_count}</strong> Followers
            </span>
            <span>
              <strong>{profile.following_count}</strong> Following
            </span>
          </div>
        </div>
        {!isSelf && (
          <button
            className={profile.viewer_follows ? "secondary" : "primary"}
            onClick={toggleFollow}
            disabled={followBusy}
          >
            {followBusy ? "Saving…" : profile.viewer_follows ? "Unfollow" : "+ Follow"}
          </button>
        )}
      </section>
      {isSelf && (
        <ProfileSettings
          token={token}
          profile={profile}
          onSaved={() => {
            setAttempt((value) => value + 1);
            onChanged();
          }}
          onOpenAccount={onOpenAccount}
        />
      )}
      <div className="social-layout">
        <div className="feed-column">
          <div className="section-heading">
            <h2>{isSelf ? "Your" : `${profile.display_name.split(" ")[0]}’s`} ratings &amp; reviews</h2>
          </div>
          <PostList
            token={token}
            posts={posts}
            viewerId={viewerId}
            onOpenProfile={onOpenProfile}
            onOpenTitle={onOpenTitle}
            onEdit={onEdit}
            onChanged={() => {
              setAttempt((value) => value + 1);
              onChanged();
            }}
            empty={
              <section className="empty">
                <h2>No posts yet.</h2>
                <p>Ratings and reviews will appear here.</p>
              </section>
            }
          />
        </div>
      </div>
    </>
  );
}

function ProfileSettings({
  token,
  profile,
  onSaved,
  onOpenAccount,
}: {
  token: string;
  profile: ProfileData;
  onSaved: () => void;
  onOpenAccount: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveProfile(token, { display_name: displayName, handle, bio });
      setMessage("Profile saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rail-card profile-settings">
      <h2>Profile settings</h2>
      <form onSubmit={submit} className="composer account-form">
        <label htmlFor="profile-name">Display name</label>
        <input
          id="profile-name"
          value={displayName}
          maxLength={60}
          required
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <label htmlFor="profile-handle">Handle</label>
        <input
          id="profile-handle"
          value={handle}
          maxLength={30}
          required
          pattern="[a-z0-9_.]{3,30}"
          title="3-30 lowercase letters, numbers, dots or underscores"
          onChange={(event) => setHandle(event.target.value.toLowerCase())}
        />
        <label htmlFor="profile-bio">Bio</label>
        <textarea
          id="profile-bio"
          value={bio}
          maxLength={280}
          rows={3}
          onChange={(event) => setBio(event.target.value)}
        />
        <span className="character-count">{bio.length}/280</span>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button className="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
        <button className="secondary" type="button" onClick={onOpenAccount}>
          Manage preferences
        </button>
      </form>
    </section>
  );
}
