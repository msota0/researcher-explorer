from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ALLOW_ORIGINS
from .routes import authors as authors_routes
from .routes import graph as graph_routes

app = FastAPI(title="UM Researcher Explorer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(authors_routes.router)
app.include_router(graph_routes.router)


@app.get("/api/health")
async def health():
    return {"ok": True}
