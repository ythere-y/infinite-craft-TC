"""
LLM 调用封装。
- API 地址只允许通过服务端环境变量注入，绝不写入源码或暴露到前端
- 超时 10s，重试 2 次（指数退避）
- 未配置或调用失败时返回 None，上层负责 fallback
"""

import os
import time
from typing import Optional, Any, Dict

import requests

API_URL = os.environ.get("GLM_API_URL", "").strip()
TIMEOUT = float(os.environ.get("GLM_TIMEOUT", "10"))
MAX_RETRIES = int(os.environ.get("GLM_MAX_RETRIES", "2"))


def query(
    payload: Dict[str, Any], temperature: Optional[float] = None
) -> Optional[Dict[str, Any]]:
    """
    同步 POST。失败（网络/超时/非 2xx）返回 None。
    成功返回原始 JSON dict。

    Args:
        payload: 请求体，通常形如 {"question": "..."}
        temperature: 可选的采样温度（该 chatflow 后端若支持，会注入；不支持则忽略）
    """
    if not API_URL:
        print("[llm] GLM_API_URL is not configured; using fallback")
        return None

    # 尝试把温度注入到常见字段，后端识别哪个就用哪个
    if temperature is not None:
        payload = {
            **payload,
            "temperature": float(temperature),
            "overrideConfig": {"temperature": float(temperature)},
        }
    last_err = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = requests.post(API_URL, json=payload, timeout=TIMEOUT)
            if resp.status_code >= 500:
                # 服务端错误才重试
                last_err = f"HTTP {resp.status_code}"
                raise requests.RequestException(last_err)
            resp.raise_for_status()
            try:
                return resp.json()
            except ValueError:
                # 返回非 JSON，当作字符串包回去
                return {"text": resp.text}
        except (requests.Timeout, requests.ConnectionError) as e:
            last_err = f"{type(e).__name__}: {e}"
        except requests.RequestException as e:
            last_err = str(e)
            # 非 5xx 的 HTTPError 不重试
            if "HTTP " in last_err and not last_err.startswith("HTTP 5"):
                break
        if attempt < MAX_RETRIES:
            time.sleep(0.5 * (2**attempt))  # 0.5s, 1s
    print(f"[llm] query failed after {MAX_RETRIES + 1} attempts: {last_err}")
    return None
