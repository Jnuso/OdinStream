"""API entry point for the Odin Stream backend."""

from fastapi import FastAPI

app = FastAPI(title="Odin Stream API")


@app.get("/health")
def health() -> dict[str, str]:
    """Report that the API process can respond to requests."""
    return {"status": "ok"}
