import contextlib
import io
from pathlib import Path
import sys

import pytest


JS2PY_IMPORT_ERROR = None
try:
    # js2py prints its bytecode comparison before raising on unsupported
    # interpreters, so keep expected compatibility failures out of test output.
    with contextlib.redirect_stdout(io.StringIO()):
        import js2py
except RuntimeError as exc:
    if sys.version_info >= (3, 14) and "changes to the bytecode" in str(exc):
        js2py = None
        JS2PY_IMPORT_ERROR = str(exc)
    else:
        raise


SOURCE = Path("frontend/combine-feedback.js")
requires_js2py_runtime = pytest.mark.skipif(
    js2py is None,
    reason=f"js2py 0.74 does not support Python {sys.version_info.major}."
    f"{sys.version_info.minor}: {JS2PY_IMPORT_ERROR}",
)


def load_api():
    context = js2py.EvalJs({})
    context.execute("var window = {};")
    context.execute(SOURCE.read_text(encoding="utf-8"))
    return context.window.COMBINE_FEEDBACK


@requires_js2py_runtime
def test_three_discovery_states():
    api = load_api()
    assert api.classify(True, False) == "global_new"
    assert api.classify(False, False) == "global_known"
    assert api.classify(False, True) == "seen"


@requires_js2py_runtime
def test_global_first_has_priority_over_known_state():
    api = load_api()
    assert api.classify(True, True) == "global_new"


def test_renderer_does_not_use_inner_html():
    source = SOURCE.read_text(encoding="utf-8")
    assert ".innerHTML" not in source
    assert "textContent" in source
