"""FastAPI routes for Issue #2 community governance."""

from __future__ import annotations

import os
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import community, db

router = APIRouter(prefix="/api/community", tags=["community"])
PLAYER_COOKIE = "craft_player"
ADMIN_COOKIE = "craft_admin"


class VoteReq(BaseModel):
    value: int = Field(ge=-1, le=1)


class LoginReq(BaseModel):
    key: str


class ModerateReq(BaseModel):
    action: str
    reason_code: str
    note: str = ""


def _secure() -> bool:
    return os.getenv("APP_ENV", "dev").lower() in {"prod", "production"}


def player(request: Request | None, response: Response | None) -> str:
    player_id = community.unsign(
        request.cookies.get(PLAYER_COOKIE) if request else None
    )
    if not player_id or not player_id.startswith("p_"):
        player_id = community.new_player_id()
        if response:
            response.set_cookie(
                PLAYER_COOKIE, community.sign(player_id), max_age=31536000,
                httponly=True, secure=_secure(), samesite="lax",
            )
    return player_id


def require_admin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "拒绝跨站管理员请求")
    value = community.unsign(request.cookies.get(ADMIN_COOKIE))
    if not value or not value.startswith("admin:"):
        raise HTTPException(401, "管理员会话无效")
    try:
        expires = int(value.split(":", 1)[1])
    except ValueError:
        raise HTTPException(401, "管理员会话无效")
    if expires < int(time.time()):
        raise HTTPException(401, "管理员会话已过期")


def rate_limit(player_id: str, operation: str, limit: int = 30) -> None:
    """Fixed one-minute window. Redis failure is logged and fails open."""
    try:
        client = db.get_client()
        bucket = int(time.time()) // 60
        key = f"rate:community:{operation}:{player_id}:{bucket}"
        count = client.incr(key)
        if count == 1:
            client.expire(key, 90)
        if count > limit:
            raise HTTPException(429, "操作过于频繁，请稍后再试")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[community] rate_limit_unavailable error={type(exc).__name__}", flush=True)


@router.get("/formulas")
def formulas(limit: int = 50, offset: int = 0):
    return {"items": community.list_public(limit, offset)}


@router.get("/formulas/{formula_id}")
def formula_detail(formula_id: str, request: Request, response: Response):
    row = community.public_formula(formula_id, player(request, response))
    if not row:
        raise HTTPException(404, "公开公式不存在")
    return row


@router.post("/formulas/{formula_id}/publish")
def publish_formula(formula_id: str, request: Request, response: Response):
    player_id = player(request, response)
    rate_limit(player_id, "publish", 10)
    try:
        row = community.publish(formula_id, player_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    return {"formula": community.public_formula(row["id"], player_id)}


@router.put("/formulas/{formula_id}/vote")
def vote_formula(formula_id: str, body: VoteReq, request: Request, response: Response):
    player_id = player(request, response)
    rate_limit(player_id, "vote", 30)
    try:
        return community.vote(formula_id, player_id, body.value)
    except (ValueError, LookupError) as exc:
        raise HTTPException(400, str(exc))


@router.post("/admin/login")
def admin_login(body: LoginReq, response: Response):
    configured = os.getenv("COMMUNITY_ADMIN_KEY", "")
    if not configured or not __import__("hmac").compare_digest(body.key, configured):
        raise HTTPException(401, "管理员密钥错误或未配置")
    expires = int(time.time()) + 8 * 3600
    response.set_cookie(
        ADMIN_COOKIE, community.sign(f"admin:{expires}"), max_age=8 * 3600,
        httponly=True, secure=_secure(), samesite="strict",
    )
    return {"ok": True, "expires_at": expires}


@router.post("/admin/logout")
def admin_logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


@router.get("/admin/queue")
def admin_queue(request: Request):
    require_admin(request)
    return {"items": community.moderation_queue()}


@router.post("/admin/formulas/{formula_id}/moderate")
def admin_moderate(formula_id: str, body: ModerateReq, request: Request):
    require_admin(request)
    try:
        row = community.moderate(
            formula_id, body.action, body.reason_code, body.note
        )
        if body.action == "retire":
            try:
                db.get_client().delete(f"combo:{row['combo_key']}")
            except Exception:
                pass
        return {"formula": row}
    except (ValueError, LookupError) as exc:
        raise HTTPException(400, str(exc))
