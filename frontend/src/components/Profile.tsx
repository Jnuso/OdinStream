import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { api } from "../data/api";
import Modal from "./Modal";
import "./Profile.css";
import Skeleton from "./Skeleton";

function canReadPosts(profile: ProfileData, viewerId: string) {
  return profile.can_view_posts ?? (profile.id === viewerId || profile.visibility === "public" || profile.viewer_follows);
}

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
  followRequests,
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
  followRequests?: ReactNode;
}) {
  const target = profileId === "me" ? viewerId : profileId;
  const isSelf = target === viewerId;
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<{ token: string; target: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [editingTarget, setEditingTarget] = useState<string | null>(null);
  const [picture, setPicture] = useState<{ target: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    fetchProfile(token, target)
      .then(async data => {
        const items = canReadPosts(data, viewerId) ? await fetchProfilePosts(token, target) : [];
        if (!active) return;
        setProfile(data);
        setPosts(items);
        setLoadedFor({ token, target });
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "The profile could not be loaded."));
    return () => {
      active = false;
    };
  }, [token, viewerId, target, attempt, reloadKey]);

  useEffect(() => {
    let active = true;
    setPicture(null);
    if (loadedFor?.token === token && loadedFor.target === target && profile?.has_picture) {
      api<{ jpeg: string }>(`/api/profiles/${target}/picture`, token)
        .then(({ jpeg }) => active && setPicture({ target, url: `data:image/jpeg;base64,${jpeg}` }))
        .catch(() => {});
    }
    return () => { active = false; };
  }, [loadedFor, profile, target, token]);

  async function toggleFollow() {
    if (!profile) return;
    setFollowBusy(true);
    setError("");
    try {
      await setFollow(token, profile.id, !profile.viewer_follows && !profile.viewer_requested);
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
  if (!profile || posts === null || loadedFor?.token !== token || loadedFor.target !== target) return <><Skeleton label="Loading profile…" variant="profile" /><Skeleton label="Loading reviews…" variant="posts" count={2} /></>;
  const canViewPosts = canReadPosts(profile, viewerId);

  return (
    <div className="profile-page">
      <div className={`profile-toolbar${isSelf ? "" : " profile-toolbar-read-only"}`}>
        <span className="desktop-profile-label" aria-hidden="true">Profile</span>
        {isSelf && <button className="secondary" onClick={() => setEditingTarget(target)}>Edit profile</button>}
      </div>
      <section className="profile-header" aria-label={`${profile.display_name} profile`}>
        <span className={`avatar ${avatarColor(profile.id)} large-avatar`}>
          {picture?.target === target ? (
            <img src={picture.url} alt="" onError={() => setPicture(null)} />
          ) : initials(profile.display_name)}
        </span>
        <div className="profile-identity">
          <span className="eyebrow">@{profile.handle}</span>
          <h1>{profile.display_name}</h1>
          {canViewPosts && profile.bio.trim() && <p>{profile.bio}</p>}
        </div>
          {canViewPosts && <div className="profile-stats" aria-label="Profile statistics">
            <span>
              <strong>{profile.post_count}</strong> Posts
            </span>
            <span>
              <strong>{profile.follower_count}</strong> Followers
            </span>
            <span>
              <strong>{profile.following_count}</strong> Following
            </span>
          </div>}
        {!isSelf && (
          <button
            className={profile.viewer_follows || profile.viewer_requested ? "secondary" : "primary"}
            onClick={toggleFollow}
            disabled={followBusy}
          >
            {followBusy ? "Saving…" : profile.viewer_follows ? "Unfollow" : profile.viewer_requested ? "Cancel request" : profile.visibility === "private" ? "Request to follow" : "+ Follow"}
          </button>
        )}
      </section>
      {isSelf && followRequests}
      {isSelf && editingTarget === target && (
        <Modal label="Edit profile" onClose={() => setEditingTarget(null)}>
        <ProfileSettings
          token={token}
          profile={profile}
          onSaved={() => {
            setEditingTarget(null);
            setAttempt((value) => value + 1);
            onChanged();
          }}
          onOpenAccount={() => { setEditingTarget(null); onOpenAccount(); }}
        />
        </Modal>
      )}
      <div className="social-layout">
        <div className="feed-column">
          {canViewPosts ? <><div className="section-heading">
            <h2>{isSelf ? "Your" : `${profile.display_name.split(" ")[0]}’s`} ratings &amp; reviews</h2>
          </div>
          <PostList
            token={token}
            posts={posts}
            showProfileLink={false}
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
          </> : <section className="empty private-profile-notice">
            <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>
            <h2>This profile is private.</h2>
            <p>{profile.viewer_requested ? "Your follow request is pending approval." : "Request to follow to see their ratings and reviews."}</p>
          </section>}
        </div>
      </div>
    </div>
  );
}

async function encodeProfilePicture(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Choose a JPEG, PNG, or WebP image up to 10 MB.");
  }
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("This image could not be opened.");
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not resize the picture.");
    const side = Math.min(image.width, image.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 192, 192);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 192, 192);
    for (const quality of [0.85, 0.65, 0.45]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality).split(",")[1];
      if (jpeg && jpeg.length <= 60000) return jpeg;
    }
    throw new Error("The picture could not be resized. Choose another image.");
  } finally {
    image.close();
  }
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
  const [visibility, setVisibility] = useState(profile.visibility);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyError, setPrivacyError] = useState("");
  const [privacySaving, setPrivacySaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [handle, setHandle] = useState(profile.handle);
  const [bio, setBio] = useState(profile.bio);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [pictureSaving, setPictureSaving] = useState(false);
  const [pictureError, setPictureError] = useState("");

  async function uploadPicture(event: FormEvent) {
    event.preventDefault();
    if (!pictureFile || pictureSaving) return;
    setPictureSaving(true);
    setPictureError("");
    try {
      const jpeg = await encodeProfilePicture(pictureFile);
      await api("/api/me/profile/picture", token, { method: "PUT", body: JSON.stringify({ jpeg }) });
      onSaved();
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : "The picture could not be uploaded.");
    } finally {
      setPictureSaving(false);
    }
  }

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
    <section className="profile-editor">
      <h2>Edit profile</h2>
      <p className="muted profile-editor-intro">Make yourself at home. Choose how you appear to other members.</p>
      <form className="account-form" onSubmit={uploadPicture}>
        <label htmlFor="profile-picture">Profile picture</label>
        <input id="profile-picture" type="file" accept="image/jpeg,image/png,image/webp"
          disabled={pictureSaving} onChange={(event) => {
            setPictureFile(event.target.files?.[0] ?? null);
            setPictureError("");
          }} />
        <p className="muted small">JPEG, PNG, or WebP up to 10 MB. Visible to members who can open your profile.</p>
        {pictureError && <p className="form-error" role="alert">{pictureError}</p>}
        <button className="secondary" type="submit" disabled={!pictureFile || pictureSaving}>
          {pictureSaving ? "Uploading…" : "Upload picture"}
        </button>
      </form>
      <form onSubmit={submit} className="account-form">
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
          pattern="[A-Za-z0-9_.]{3,30}"
          title="3-30 letters, numbers, dots or underscores"
          onChange={(event) => setHandle(event.target.value)}
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
      <form className="account-form" onSubmit={async (event) => {
        event.preventDefault(); setPrivacySaving(true); setPrivacyError(""); setPrivacyMessage("");
        try {
          await api("/api/me/profile/visibility", token, { method: "PATCH", body: JSON.stringify({ visibility }) });
          setPrivacyMessage("Privacy saved."); onSaved();
        } catch (err) { setPrivacyError(err instanceof Error ? err.message : "Could not update privacy."); }
        finally { setPrivacySaving(false); }
      }}>
        <label htmlFor="profile-visibility">Profile privacy</label>
        <select id="profile-visibility" value={visibility} onChange={event => setVisibility(event.target.value as "public" | "private")}>
          <option value="private">Private</option><option value="public">Public</option>
        </select>
        <p className="muted small">Making your profile public automatically approves pending follow requests.</p>
        {privacyError && <p className="form-error" role="alert">{privacyError}</p>}
        {privacyMessage && <p role="status">{privacyMessage}</p>}
        <button type="submit" className="secondary" disabled={privacySaving}>Save privacy</button>
      </form>
    </section>
  );
}
