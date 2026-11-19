"""Shared PostgreSQL connection pooling with transaction-local `odin_api` scoping."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock
from typing import Any

from psycopg_pool import ConnectionPool

_pools: dict[str, ConnectionPool] = {}
_pool_lock = Lock()


def get_pool(database_url: str) -> ConnectionPool:
    """Return (or lazily initialize) the shared ConnectionPool for ``database_url``."""
    with _pool_lock:
        pool = _pools.get(database_url)
        if pool is None or pool.closed:
            pool = ConnectionPool(
                conninfo=database_url,
                min_size=1,
                max_size=10,
                open=True,
                kwargs={"connect_timeout": 5},
            )
            _pools[database_url] = pool
        return pool


_get_pool = get_pool


@contextmanager
def user_connection(database_url: str, user_id: str, *, row_factory: Any = None) -> Iterator[Any]:
    """Yield a pooled connection scoped to `odin_api` and `app.user_id` for one transaction."""
    pool = get_pool(database_url)
    with pool.connection() as conn:
        original_factory = conn.row_factory
        if row_factory is not None:
            conn.row_factory = row_factory
        try:
            with conn.transaction():
                conn.execute("set local role odin_api")
                conn.execute("select set_config('app.user_id', %s, true)", (user_id,))
                yield conn
        finally:
            if row_factory is not None:
                conn.row_factory = original_factory


def close_pools() -> None:
    """Close all open database connection pools on application shutdown."""
    with _pool_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        if not pool.closed:
            pool.close()
