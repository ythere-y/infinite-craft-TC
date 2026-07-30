from __future__ import annotations

import html
import json
from pathlib import Path
import re
import subprocess

from test_combine_feedback import (
    APP_SOURCE,
    EFFECTS_SOURCE,
    ICON_SOURCE,
    INDEX_SOURCE,
    SCORE_LEVEL_SOURCE,
    SOURCE,
    _browser_path,
    _production_stylesheet_paths,
)


def _run_score_effects(tmp_path: Path, script: str, virtual_time_budget: int = 12_000):
    styles = "".join(path.read_text(encoding="utf-8") for path in _production_stylesheet_paths())
    page = tmp_path / "score-effects-runtime.html"
    page.write_text("\n".join([
        "<!doctype html><meta charset=utf-8>",
        f"<style>{styles}</style>",
        '<button id="score-source">source</button>',
        '<button id="btn-score"><span class="score-content">score</span></button>',
        '<pre id="result"></pre>',
        "<script>",
        "window.COMBINE_FEEDBACK={renderToast:function(){}};",
        "window.matchMedia=function(){return {matches:false}};",
        "</script>",
        f"<script>{EFFECTS_SOURCE.read_text(encoding='utf-8')}</script>",
        "<script>",
        "Promise.resolve().then(function(){return (async function(){",
        script,
        "})()}).then(function(value){",
        "document.querySelector('#result').textContent=JSON.stringify({ok:true,value:value})",
        "},function(error){",
        "document.querySelector('#result').textContent=JSON.stringify({ok:false,error:String(error&&error.stack||error)})",
        "})",
        "</script>",
    ]), encoding="utf-8")
    done = subprocess.run([
        str(_browser_path()), "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-background-networking", "--no-first-run", "--no-default-browser-check",
        f"--virtual-time-budget={virtual_time_budget}",
        f"--user-data-dir={tmp_path / 'score-effects-profile'}",
        "--dump-dom", page.as_uri(),
    ], check=False, capture_output=True, encoding="utf-8", timeout=25)
    assert done.returncode == 0, done.stderr
    result = re.search(r'<pre id="result">(.*?)</pre>', done.stdout, re.S)
    payload = json.loads(html.unescape(result.group(1)))
    assert payload["ok"], payload["error"]
    return payload["value"]


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


def test_score_animation_serializes_jobs_inside_target_and_cleans_up(tmp_path):
    actual = _run_score_effects(tmp_path, """
      var source=document.querySelector('#score-source');
      var target=document.querySelector('#btn-score');
      var targetTwo=document.createElement('button');
      targetTwo.id='detached-score-target';
      document.body.appendChild(targetTwo);
      var events=[],placements=[],flightDurations=[],residueDurations=[];
      var observer=new MutationObserver(function(records){
        records.forEach(function(record){record.addedNodes.forEach(function(node){
          if(node.nodeType!==1)return;
          if(node.matches('.score-flight')){
            events.push('flight:'+node.textContent);
            flightDurations.push(getComputedStyle(node).animationDuration);
          }
          if(node.matches('.score-gain-residue')){
            events.push('residue:'+node.textContent);
            residueDurations.push(getComputedStyle(node).animationDuration);
          }
          if(node.matches('.level-gain-star')){
            events.push('gain:'+node.textContent);
            placements.push(target.contains(node));
          }
          if(node.matches('.level-fusion-result')){
            events.push('merge:'+node.textContent);
            placements.push(target.contains(node));
          }
        })});
      });
      observer.observe(document.body,{childList:true,subtree:true});
      window.EFFECTS.animateScoreGain({
        source:source,target:target,delta:90,
        before:{level_units:63},after:{level_units:64},
        steps:[
          {type:'gain',icon:'🌟'},
          {type:'merge',from:'🌟',to:'🌙'},
          {type:'merge',from:'🌙',to:'🌞'},
          {type:'merge',from:'🌞',to:'👑'}
        ],
        renderFinal:function(){
          target.dataset.final='first';
          events.push('final:first');
        }
      });
      window.EFFECTS.animateScoreGain({
        source:source,target:targetTwo,delta:5,
        before:{level_units:64},after:{level_units:64},steps:[],
        renderFinal:function(){events.push('final:detached')}
      });
      targetTwo.remove();
      await new Promise(function(resolve){setTimeout(resolve,8000)});
      observer.disconnect();
      return {
        events:events,placements:placements,
        flightDurations:flightDurations,residueDurations:residueDurations,
        directUpgradeNodes:Array.from(document.body.children).filter(function(node){
          return node.matches('.level-gain-star,.level-fusion-source,.level-fusion-result')
        }).length,
        remaining:document.querySelectorAll(
          '.score-flight,.score-gain-residue,.score-level-effect-layer,'+
          '.level-gain-star,.level-fusion-source,.level-fusion-result'
        ).length,
        receiving:target.classList.contains('score-receive'),
        finalState:target.dataset.final
      };
    """)
    assert actual["events"] == [
        "flight:+90 分",
        "residue:+90 分",
        "gain:🌟",
        "merge:🌙",
        "merge:🌞",
        "merge:👑",
        "final:first",
        "final:detached",
    ]
    assert actual["placements"] == [True, True, True, True]
    assert actual["flightDurations"] == ["1.1s"]
    assert actual["residueDurations"] == ["1.4s"]
    assert actual["directUpgradeNodes"] == 0
    assert actual["remaining"] == 0
    assert actual["receiving"] is False
    assert actual["finalState"] == "first"


def test_score_animation_uses_text_nodes_for_untrusted_payloads(tmp_path):
    hostile = '<img id="score-animation-xss" src=x onerror="window.__scoreXss=1">'
    actual = _run_score_effects(tmp_path, f"""
      window.__scoreXss=0;
      var source=document.querySelector('#score-source');
      var target=document.querySelector('#btn-score');
      var seen=[];
      var observer=new MutationObserver(function(records){{
        records.forEach(function(record){{record.addedNodes.forEach(function(node){{
          if(node.nodeType===1&&node.matches(
            '.score-flight,.score-gain-residue,.level-gain-star,.level-fusion-source,.level-fusion-result'
          ))seen.push(node.textContent)
        }})}})
      }});
      observer.observe(document.body,{{childList:true,subtree:true}});
      window.EFFECTS.animateScoreGain({{
        source:source,target:target,delta:{json.dumps(hostile)},
        before:{{level_units:0}},after:{{level_units:1}},
        steps:[
          {{type:'gain',icon:{json.dumps(hostile)}}},
          {{type:'merge',from:{json.dumps(hostile)},to:{json.dumps(hostile)}}}
        ],
        renderFinal:function(){{seen.push('final')}}
      }});
      await new Promise(function(resolve){{setTimeout(resolve,5000)}});
      observer.disconnect();
      return {{seen:seen,injected:!!document.querySelector('#score-animation-xss'),
        xss:window.__scoreXss}};
    """)
    assert actual["seen"] == [
        f"+{hostile} 分",
        f"+{hostile} 分",
        hostile,
        hostile,
        hostile,
        hostile,
        hostile,
        hostile,
        "final",
    ]
    assert actual["injected"] is False
    assert actual["xss"] == 0


def test_score_animation_reduced_motion_keeps_residue_and_finalizes(tmp_path):
    actual = _run_score_effects(tmp_path, """
      window.matchMedia=function(){return {matches:true}};
      var source=document.querySelector('#score-source');
      var target=document.querySelector('#btn-score');
      var animatedNodes=0,sawReceive=false,duringFinal=null,finalCalls=0;
      var observer=new MutationObserver(function(records){
        records.forEach(function(record){
          if(record.type==='attributes'&&target.classList.contains('score-receive')){
            sawReceive=true
          }
          record.addedNodes&&record.addedNodes.forEach(function(node){
            if(node.nodeType===1&&node.matches(
              '.score-flight,.score-level-effect-layer,.level-gain-star,'+
              '.level-fusion-source,.level-fusion-result'
            ))animatedNodes+=1
          })
        })
      });
      observer.observe(document.body,{childList:true,subtree:true,attributes:true});
      window.EFFECTS.animateScoreGain({
        source:source,target:target,delta:90,
        before:{level_units:63},after:{level_units:64},
        steps:[
          {type:'gain',icon:'🌟'},
          {type:'merge',from:'🌟',to:'🌙'}
        ],
        renderFinal:function(){
          finalCalls+=1;
          duringFinal=target.querySelector('.score-gain-residue')?.textContent||null
        }
      });
      await new Promise(function(resolve){setTimeout(resolve,2200)});
      observer.disconnect();
      return {
        animatedNodes:animatedNodes,sawReceive:sawReceive,
        duringFinal:duringFinal,finalCalls:finalCalls,
        residueAfterCleanup:!!target.querySelector('.score-gain-residue'),
        receiving:target.classList.contains('score-receive')
      };
    """)
    assert actual == {
        "animatedNodes": 0,
        "sawReceive": True,
        "duringFinal": "+90 分",
        "finalCalls": 1,
        "residueAfterCleanup": False,
        "receiving": False,
    }
