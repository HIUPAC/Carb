"""Bounded DeepSeek Chat Completions relay for the public Carb workbench."""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request as UpstreamRequest, build_opener

import uvicorn
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

ORIGIN = "https://houpac.top"
MODEL = "deepseek-flash"
UPSTREAM = "https://api.deepseek.com/chat/completions"
MAX_BODY_BYTES = 384 * 1024
MAX_RESPONSE_BYTES = 256 * 1024
MAX_OUTPUT_TOKENS = 2048
DAILY_LIMIT = 60
MINUTE_LIMIT = 8
CHINA_TIME = timezone(timedelta(hours=8))
QUOTA_LOCK = Lock()
LOGGER = logging.getLogger("uvicorn.error")

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
    expose_headers=["Retry-After"],
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def failure(status, message, retry_after=None):
    headers = {"Cache-Control": "no-store"}
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return JSONResponse({"error": {"message": message}}, status_code=status, headers=headers)


def reserve_call():
    """Persist the shared budget before sending a request to DeepSeek."""
    path = Path(os.environ.get("CARB_QUOTA_PATH", "/mnt/workspace/carb-deepseek-quota.json"))

    with QUOTA_LOCK:
        now = datetime.now(CHINA_TIME)
        tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=CHINA_TIME)
        minute = int(now.timestamp()) // 60
        day = now.date().isoformat()
        try:
            usage = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            usage = {}

        day_calls = usage["day_calls"] if usage.get("day") == day else 0
        minute_calls = usage["minute_calls"] if usage.get("minute") == minute else 0
        if day_calls >= DAILY_LIMIT:
            return int((tomorrow - now).total_seconds()) + 1
        if minute_calls >= MINUTE_LIMIT:
            return 60 - now.second

        record = {"day": day, "day_calls": day_calls + 1, "minute": minute, "minute_calls": minute_calls + 1}
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
            pending = Path(file.name)
            json.dump(record, file)
        try:
            pending.replace(path)
        finally:
            pending.unlink(missing_ok=True)
    return None

def forward(payload, api_key):
    upstream_request = UpstreamRequest(
        UPSTREAM,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with build_opener(NoRedirect).open(upstream_request, timeout=45) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            return failure(502, "DeepSeek 的响应超出大小限制。")
        result = json.loads(body)
        choices = result.get("choices")
        if not isinstance(choices, list) or not choices:
            return failure(502, "DeepSeek 返回了无法使用的响应。")
        return JSONResponse({"model": MODEL, "choices": choices}, headers={"Cache-Control": "no-store"})
    except HTTPError as error:
        status = error.code
        error.close()
        LOGGER.warning("DeepSeek upstream returned HTTP %d", status)
        if status == 429:
            return failure(429, "DeepSeek 当前请求过多，请稍后重试或切换到自带密钥。", 60)
        if status in {401, 402, 403}:
            return failure(503, "网页自带 DeepSeek 暂不可用。你可以切换到自带密钥。")
        if status in {400, 413, 422}:
            return failure(400, "DeepSeek 无法处理此请求，请缩短输入或调整所用工具。")
        return failure(502, "DeepSeek 暂未响应，请稍后重试。")
    except (URLError, TimeoutError, ValueError, AttributeError):
        return failure(502, "DeepSeek 暂未响应，请稍后重试。")


@app.get("/")
async def health():
    return {"service": "Carb DeepSeek", "model": MODEL}


@app.post("/chat/completions")
async def chat_completions(request: Request):
    if request.headers.get("origin") != ORIGIN:
        return failure(403, "请通过 Carb 网页工作台使用此服务。")
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return failure(503, "网页自带 DeepSeek 尚未配置。你可以切换到自带密钥。")

    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_BODY_BYTES:
            return failure(413, "请求太大，请减少文件内容或切换到自带密钥。")
        raw.extend(chunk)

    try:
        incoming = json.loads(raw)
    except (ValueError, RecursionError):
        return failure(400, "请求必须是有效的 JSON。")

    messages = incoming.get("messages") if isinstance(incoming, dict) else None
    if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
        return failure(400, "请发送 1 到 100 条消息。")
    if any(not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant", "tool")
           or not isinstance(message.get("content"), (str, type(None))) for message in messages):
        return failure(400, "此入口只接受文本消息和工具结果。")

    tools = incoming.get("tools", [])
    if not isinstance(tools, list) or len(tools) > 64:
        return failure(400, "每次最多可使用 64 个工具。")

    try:
        retry_after = await run_in_threadpool(reserve_call)
    except (OSError, ValueError, TypeError, AttributeError, KeyError) as error:
        LOGGER.warning("DeepSeek quota storage unavailable (%s)", type(error).__name__)
        return failure(503, "网页自带 DeepSeek 暂不可用。你可以切换到自带密钥。")
    if retry_after is not None:
        return failure(429, "网页自带 DeepSeek 的共享额度暂时用完。你可以稍后重试或切换到自带密钥。", retry_after)

    payload = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "stream": False,
        "thinking": {"type": "disabled"},
    }
    if tools:
        payload["tools"] = tools
    return await run_in_threadpool(forward, payload, api_key)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860, workers=1, access_log=False)
