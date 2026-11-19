"""API entry point for the Odin Stream backend."""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.account_deletion import router as account_deletion_router
from app.accounts import router as accounts_router
from app.catalog import router as catalog_router, filtered_router as filtered_catalog_router
from app.errors import APIError
from app.library import router as library_router
from app.recommendations import router as recommendations_router
from app.social import router as social_router
from app.settings import get_settings

app = FastAPI(title="Odin Stream API")
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(accounts_router)
app.include_router(account_deletion_router)
app.include_router(catalog_router)
app.include_router(filtered_catalog_router)
app.include_router(library_router)
app.include_router(social_router)
app.include_router(recommendations_router)


@app.middleware("http")
async def private_account_responses(request, call_next):
    response = await call_next(request)
    if request.url.path == "/api/me" or request.url.path.startswith("/api/me/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


@app.exception_handler(StarletteHTTPException)
def handle_http_error(_request, exc: StarletteHTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
    return JSONResponse(status_code=exc.status_code, headers=exc.headers,
                        content={"error": "http_error", "message": message})


@app.exception_handler(RequestValidationError)
def handle_validation_error(_request, exc: RequestValidationError) -> JSONResponse:
    details = [{"field": ".".join(str(part) for part in error["loc"] if part != "body"),
                "message": error["msg"]} for error in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "validation_error",
                        "message": "Check the submitted information.", "details": details})


@app.exception_handler(APIError)
def handle_api_error(_request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.error, "message": exc.message},
    )


@app.get("/health")
def health() -> dict[str, str]:
    """Report that the API process can respond to requests."""
    return {"status": "ok"}
