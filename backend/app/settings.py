"""Runtime configuration. Secrets come from the environment, never from source."""

from functools import lru_cache
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    jwt_secret: str
    database_url: str
    cors_origins: tuple[str, ...]

    @property
    def issuer(self) -> str:
        if not self.supabase_url:
            return ""
        return f"{self.supabase_url}/auth/v1"

    @property
    def jwks_url(self) -> str:
        if not self.supabase_url:
            return ""
        return f"{self.issuer}/.well-known/jwks.json"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    origins = os.environ.get(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    )
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        jwt_secret=os.environ.get("SUPABASE_JWT_SECRET", ""),
        database_url=os.environ.get("DATABASE_URL", ""),
        cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
    )
