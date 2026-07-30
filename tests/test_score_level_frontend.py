from __future__ import annotations

import html
import json
from pathlib import Path
import re
import subprocess

from test_combine_feedback import (
    APP_SOURCE,
    ICON_SOURCE,
    INDEX_SOURCE,
    SCORE_LEVEL_SOURCE,
    SOURCE,
    _browser_path,
    _production_stylesheet_paths,
)


def _run_score_app(tmp_path: Path, script: str, setup: str = ""):
    index = INDEX_SOURCE.read_text(encoding="utf-8")
    body = re.search(r"<body>([\s\S]*?)</body>", index).group(1)
    body = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*></script>', "", body)
    styles = "".join(path.read_text(encoding="utf-8") for path in _production_stylesheet_paths())
    page = tmp_path / "score-runtime.html"
    page.write_text("\n".join([
        "<!doctype html><meta charset=utf-8>", f"<style>{styles}</style>", body,
        '<pre id="result"></pre>', "<script>",
        "window.alert=function(){};window.confirm=function(){return true};",
        "window.EFFECTS={initBossMode:function(){}};",
        "window.RECIPE_LINKS={create:function(){return {sync:function(){},scheduleGeometryUpdate:function(){},clear:function(){},destroy:function(){}}}};",
        "window.fetch=function(url){var p=String(url),x=p.includes('element-icon-map')?{'预设':{icon:{base:'🧩',palette:'product',source:'preset'}}}:p.includes('/api/starters')?[]:p.includes('/api/elements')?{}:{};return Promise.resolve({ok:true,json:function(){return Promise.resolve(x)}})};",
        "localStorage.setItem('ic_nick','测试');localStorage.setItem('ic_nick_id','test');",
        "</script>", f"<script>{ICON_SOURCE.read_text(encoding='utf-8')}</script>",
        f"<script>{SOURCE.read_text(encoding='utf-8')}</script>",
        f"<script>{SCORE_LEVEL_SOURCE.read_text(encoding='utf-8')}</script>",
        f"<script>{setup}</script>", f"<script>{APP_SOURCE.read_text(encoding='utf-8')}</script>",
        "<script>window.ICON_SYSTEM.ready.then(function(){return new Promise(function(r){setTimeout(r,0)})}).then(function(){try{var v=(function(){",
        script,
        "})();document.querySelector('#result').textContent=JSON.stringify({ok:true,value:v})}catch(e){document.querySelector('#result').textContent=JSON.stringify({ok:false,error:String(e.stack||e)})}})</script>",
    ]), encoding="utf-8")
    done = subprocess.run([
        str(_browser_path()), "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        "--virtual-time-budget=1000", f"--user-data-dir={tmp_path / 'profile'}",
        "--dump-dom", page.as_uri(),
    ], check=False, capture_output=True, encoding="utf-8", timeout=20)
    assert done.returncode == 0, done.stderr
    result = re.search(r'<pre id="result">(.*?)</pre>', done.stdout, re.S)
    payload = json.loads(html.unescape(result.group(1)))
    assert payload["ok"], payload["error"]
    return payload["value"]


def test_score_level_renders_moon_boundary_and_safe_level_text(tmp_path):
    actual = _run_score_app(tmp_path, """
      document.querySelector('#btn-score').click();
      return {home:document.querySelector('#score-level-icons').textContent,
        total:document.querySelector('#score-panel-total').textContent,
        panel:document.querySelector('#score-panel-full-icons').textContent,
        progress:document.querySelector('#score-panel-progress-fill').style.width,
        gained:document.querySelector('.score-row .gain').textContent};
    """, """
      localStorage.setItem('ic_kpi','1320');
      localStorage.setItem('ic_scores',JSON.stringify([{result:'月亮合成',emoji:'🌙',gained:37,depth:4,tier:'global_new',ts:Date.now()}]));
    """)
    assert actual == {"home": "🌙", "total": "1320", "panel": "🌙", "progress": "0%", "gained": "+37"}


def test_score_level_hostile_icons_remain_text(tmp_path):
    hostile = '<img id="level-xss" src=x onerror="window.__xss=1">'
    actual = _run_score_app(tmp_path, """
      document.querySelector('#btn-score').click();
      return {injected:!!document.querySelector('#level-xss'),home:document.querySelector('#score-level-icons').textContent,panel:document.querySelector('#score-panel-full-icons').textContent,xss:window.__xss};
    """, f"""
      window.__xss=0;window.SCORE_LEVEL=Object.assign({{}},window.SCORE_LEVEL,{{rankFor:function(){{return {{level_units:1,icons:{json.dumps(hostile)},aria_label:'测试等级',progress:.5}}}}}});
    """)
    assert actual == {"injected": False, "home": hostile, "panel": hostile, "xss": 0}
