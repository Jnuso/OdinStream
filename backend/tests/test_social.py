import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from app.errors import APIError
from app.main import app
from app.settings import Settings, get_settings
from app.social import shape_post, social_store


class FakeStore:
    """Minimal in-memory stand-in for the Postgres store."""

    def __init__(self):
        self.posts = {}
        self.follows = set()
        self.profiles = {}

    def profile(self, viewer_id, profile_id):
        row = self.profiles.get(profile_id)
        if row is None:
            raise APIError(404, "profile_not_found", "Profile not found.")
        return {**row, "viewer_follows": (viewer_id, profile_id) in self.follows}

    def profiles(self, viewer_id, limit):
        return [self.profile(viewer_id, key) for key in list(self.profiles)[:limit]
                if key != viewer_id]

    def update_profile(self, user_id, display_name, handle, bio):
        self.profiles[user_id] = {"id": user_id, "display_name": display_name, "handle": handle, "bio": bio}
        return self.profile(user_id, user_id)

    def feed(self, user_id, scope, limit, offset):
        rows = [row for row in self.posts.values()
                if scope == "public" or row["author_id"] == user_id
                or row["author_id"] in self.following_ids(user_id)]
        ordered = sorted(rows, key=lambda row: row["created_at"], reverse=True)[offset:offset + limit]
        return [shape_post(row) for row in ordered]

    def posts_by_author(self, user_id, profile_id, limit, offset):
        return [shape_post(row) for row in self.posts.values()
                if row["author_id"] == profile_id][offset:offset + limit]

    def posts_for_title(self, user_id, media_type, tmdb_id, limit):
        return [shape_post(row) for row in self.posts.values()
                if row["media_type"] == media_type and row["tmdb_id"] == tmdb_id]

    def create(self, user_id, media_type, tmdb_id, title, rating, review):
        if any(row["author_id"] == user_id and row["media_type"] == media_type
               and row["tmdb_id"] == tmdb_id for row in self.posts.values()):
            raise APIError(409, "duplicate_post", "You already posted about this title. Edit that post instead.")
        post_id = str(uuid4())
        row = {"id": post_id, "media_type": media_type, "tmdb_id": tmdb_id, "title_name": title["name"],
               "poster_path": title["poster_path"], "release_date": title["release_date"],
               "rating": rating, "review": review,
               "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc),
               "author_id": user_id, "author_name": "Tester", "author_handle": "tester"}
        self.posts[post_id] = row
        return shape_post(row)

    def update(self, user_id, post_id, rating, review):
        row = self.posts.get(str(post_id))
        if row is None or row["author_id"] != user_id:
            raise APIError(404, "post_not_found", "Post not found.")
        row.update(rating=rating, review=review)
        return shape_post(row)

    def delete(self, user_id, post_id):
        row = self.posts.get(str(post_id))
        if row is None or row["author_id"] != user_id:
            raise APIError(404, "post_not_found", "Post not found.")
        self.posts.pop(str(post_id))

    def follow(self, user_id, profile_id):
        if profile_id not in self.profiles:
            raise APIError(404, "profile_not_found", "Profile not found.")
        self.follows.add((user_id, profile_id))

    def unfollow(self, user_id, profile_id):
        self.follows.discard((user_id, profile_id))

    def following_ids(self, user_id):
        return [followee for follower, followee in self.follows if follower == user_id]


class SocialTest(unittest.TestCase):
    def setUp(self):
        self.secret = "a-test-secret-that-is-longer-than-32-bytes"
        self.settings = Settings("https://example.supabase.co", self.secret, "", ())
        self.store = FakeStore()
        app.dependency_overrides[get_settings] = lambda: self.settings
        app.dependency_overrides[social_store] = lambda: self.store
        self.client = TestClient(app)
        self.user_a, self.user_b = str(uuid4()), str(uuid4())
        self.store.profiles[self.user_a] = {"id": self.user_a, "display_name": "Ada", "handle": "ada.111111", "bio": ""}
        self.store.profiles[self.user_b] = {"id": self.user_b, "display_name": "Grace", "handle": "grace.222222", "bio": ""}

    def tearDown(self):
        app.dependency_overrides.clear()

    def headers(self, user):
        token = jwt.encode({"sub": user, "aud": "authenticated", "iss": self.settings.issuer,
                            "exp": int(time.time()) + 600, "role": "authenticated"}, self.secret, algorithm="HS256")
        return {"Authorization": "Bearer " + token}

    def publish(self, user, rating=5, review="Great."):
        with patch("app.social.tmdb_get", return_value={"id": 603, "title": "The Matrix",
                                                        "poster_path": "/poster.jpg", "release_date": "1999-03-31"}):
            return self.client.post("/api/titles/movie/603/posts", headers=self.headers(user),
                                    json={"rating": rating, "review": review})

    def test_requires_auth(self):
        self.assertEqual(self.client.get("/api/feed").status_code, 401)
        self.assertEqual(self.client.post("/api/titles/movie/603/posts", json={"rating": 5}).status_code, 401)

    def test_publish_edit_and_delete_own_post(self):
        created = self.publish(self.user_a)
        self.assertEqual(created.status_code, 201)
        body = created.json()
        self.assertEqual((body["title_name"], body["rating"], body["author"]["id"]), ("The Matrix", 5, self.user_a))

        duplicate = self.publish(self.user_a, rating=3)
        self.assertEqual(duplicate.status_code, 409)

        updated = self.client.patch(f"/api/posts/{body['id']}", headers=self.headers(self.user_a),
                                    json={"rating": 4, "review": "Second watch."})
        self.assertEqual((updated.status_code, updated.json()["rating"]), (200, 4))

        self.assertEqual(self.client.delete(f"/api/posts/{body['id']}",
                                            headers=self.headers(self.user_b)).status_code, 404)
        self.assertEqual(self.client.delete(f"/api/posts/{body['id']}",
                                            headers=self.headers(self.user_a)).status_code, 204)

    def test_half_star_and_review_length(self):
        response = self.publish(self.user_a, rating=4.5, review="x" * 2000)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["rating"], 4.5)
        self.assertEqual(self.publish(self.user_b, rating=0.5, review="x" * 2001).status_code, 422)

    def test_rating_bounds_and_unverified_title(self):
        for rating in (0, 6, 1.2, "five"):
            self.assertEqual(self.publish(self.user_a, rating=rating).status_code, 422)
        with patch("app.social.tmdb_get", side_effect=APIError(404, "title_not_found", "missing")):
            response = self.client.post("/api/titles/movie/999/posts", headers=self.headers(self.user_a),
                                        json={"rating": 5})
        self.assertEqual(response.status_code, 404)

    def test_feed_scopes_and_follows(self):
        self.publish(self.user_a)
        self.publish(self.user_b, rating=4)
        public = self.client.get("/api/feed?scope=public", headers=self.headers(self.user_b)).json()["items"]
        self.assertEqual(len(public), 2)
        following = self.client.get("/api/feed?scope=following", headers=self.headers(self.user_b)).json()["items"]
        self.assertEqual([item["author"]["id"] for item in following], [self.user_b])

        self.assertEqual(self.client.put(f"/api/profiles/{self.user_a}/follow",
                                         headers=self.headers(self.user_b)).status_code, 204)
        after = self.client.get("/api/feed?scope=following", headers=self.headers(self.user_b)).json()["items"]
        self.assertEqual(len(after), 2)
        self.assertEqual(self.client.put(f"/api/profiles/{self.user_b}/follow",
                                         headers=self.headers(self.user_b)).status_code, 422)
        self.assertEqual(self.client.delete(f"/api/profiles/{self.user_a}/follow",
                                            headers=self.headers(self.user_b)).status_code, 204)
        self.assertEqual(self.client.get("/api/feed?scope=following",
                                         headers=self.headers(self.user_b)).json()["items"][0]["author"]["id"], self.user_b)

    def test_profile_update_validation(self):
        self.assertEqual(self.client.patch("/api/me/profile", headers=self.headers(self.user_a),
                                           json={"display_name": "  ", "handle": "ada.ok"}).status_code, 422)
        self.assertEqual(self.client.patch("/api/me/profile", headers=self.headers(self.user_a),
                                           json={"display_name": "Ada", "handle": "Not A Handle"}).status_code, 422)
        updated = self.client.patch("/api/me/profile", headers=self.headers(self.user_a),
                                    json={"display_name": "Ada L.", "handle": "ada.l", "bio": "Watches films."})
        self.assertEqual((updated.status_code, updated.json()["handle"]), (200, "ada.l"))
        own = self.client.get("/api/me/profile", headers=self.headers(self.user_a))
        self.assertEqual(own.json()["display_name"], "Ada L.")
        self.assertEqual(own.headers["cache-control"], "private, no-store")

    def test_title_posts_and_profile_posts(self):
        self.publish(self.user_a)
        title_posts = self.client.get("/api/titles/movie/603/posts", headers=self.headers(self.user_b))
        self.assertEqual(len(title_posts.json()["items"]), 1)
        profile_posts = self.client.get(f"/api/profiles/{self.user_a}/posts", headers=self.headers(self.user_b))
        self.assertEqual(len(profile_posts.json()["items"]), 1)


if __name__ == "__main__":
    unittest.main()
