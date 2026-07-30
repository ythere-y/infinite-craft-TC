# Task 1 report: unlimited score-level domains

## Implementation summary

Replaced the finite score/绩效 tiers in the Python and Edge runtime domains
with an unbounded, integer-safe score-level model.  Each level costs 300 plus
20 more than the preceding level; level units are rendered as base-four
`👑`, `🌞`, `🌙`, and `🌟` counts.  Both rank APIs normalize negative input
to zero and never report `topped: true`.  The Edge API additionally clamps
numeric input to `Number.MAX_SAFE_INTEGER` before its threshold search.

The existing score and explosion behavior remains unchanged.  The Edge
`emoji` value uses code-point indexing so it returns a complete emoji rather
than a UTF-16 surrogate half.

The supplied 1,280 four-star/moon boundary was corrected to 1,320 after
approval: the specified formula evaluates level four to 1,320, and 1,280
would contradict the required strict increase in marginal costs.  The task
brief and executable plan were updated consistently, including the browser
helper assertion.

## Files changed

- `backend/kpi.py`
- `edge-functions/_lib/kpi.js`
- `tests/test_kpi.py`
- `tests-makers/domain.test.mjs`
- `docs/superpowers/plans/2026-07-30-score-level-system.md`
- `.superpowers/sdd/2026-07-30-score-level-system/task-1-brief.md`
- `.superpowers/sdd/2026-07-30-score-level-system/task-1-report.md`

## TDD evidence

### RED

Command:

```text
python3 -m pytest tests/test_kpi.py -q
```

Output:

```text
FFFF                                                                     [100%]
=================================== FAILURES ===================================
_________ test_score_level_uses_linear_star_costs_and_base_four_icons __________

    def test_score_level_uses_linear_star_costs_and_base_four_icons():
>       assert kpi.level_threshold(0) == 0
               ^^^^^^^^^^^^^^^^^^^
E       AttributeError: module 'backend.kpi' has no attribute 'level_threshold'

_____________ test_score_level_boundaries_are_exact_and_unlimited ______________

    def test_score_level_boundaries_are_exact_and_unlimited():
        for units in (1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024):
>           floor = kpi.level_threshold(units)
                    ^^^^^^^^^^^^^^^^^^^
E           AttributeError: module 'backend.kpi' has no attribute 'level_threshold'

_____________ test_each_new_star_costs_more_than_the_previous_star _____________

    def test_each_new_star_costs_more_than_the_previous_star():
>       costs = [
            kpi.level_threshold(units) - kpi.level_threshold(units - 1)
            for units in range(1, 200)
        ]

tests/test_kpi.py:32:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

.0 = <range_iterator object at 0x7fc24e12c840>

    costs = [
>       kpi.level_threshold(units) - kpi.level_threshold(units - 1)
        ^^^^^^^^^^^^^^^^^^^
        for units in range(1, 200)
    ]
E   AttributeError: module 'backend.kpi' has no attribute 'level_threshold'

____________________ test_invalid_scores_normalize_to_zero _____________________

    def test_invalid_scores_normalize_to_zero():
>       assert kpi.rank_for(-1) == kpi.rank_for(0)
E       AssertionError: assert {'all_tiers':...loor': 0, ...} == {'all_tiers':...loor': 0, ...}
E         
E         Omitting 10 identical items, use -vv to show
E         Differing items:
E         {'next_grade': '瑞雪'} != {'next_grade': '3.25'}
E         {'to_next': 8001} != {'to_next': 500}
E         {'next_label': '瑞雪兆丰年'} != {'next_label': '勉强合格'}
E         {'next_floor': 8000} != {'next_floor': 500}
E         {'next_emoji': '❄️'} != {'next_emoji': '🟡'}
E         Use -v to get more diff

=========================== short test summary info ============================
FAILED tests/test_kpi.py::test_score_level_uses_linear_star_costs_and_base_four_icons
FAILED tests/test_kpi.py::test_score_level_boundaries_are_exact_and_unlimited
FAILED tests/test_kpi.py::test_each_new_star_costs_more_than_the_previous_star
FAILED tests/test_kpi.py::test_invalid_scores_normalize_to_zero - AssertionEr...
4 failed in 0.06s
```

Command:

```text
node --test tests-makers/domain.test.mjs
```

Output:

```text
file:///data/workspace/06.infinity_craft/06.infinity_craft/tests-makers/domain.test.mjs:5
  levelThreshold,
  ^^^^^^^^^^^^^^
SyntaxError: The requested module '../edge-functions/_lib/kpi.js' does not provide an export named 'levelThreshold'
    at #_instantiate (node:internal/modules/esm/module_job:254:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:363:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:669:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.6.0
✖ tests-makers/domain.test.mjs (63.16863ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 71.291166

✖ failing tests:

test at tests-makers/domain.test.mjs:1:1
✖ tests-makers/domain.test.mjs (63.16863ms)
  'test failed'
```

Command (Unicode regression):

```text
node --test tests-makers/domain.test.mjs
```

Output:

```text
✖ tests-makers/domain.test.mjs (112.51775ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 121.464668
```

This failure was caused by `icons[0]` yielding a UTF-16 surrogate half rather
than `"🌟"`.

### GREEN

Command:

```text
python3 -m pytest tests/test_kpi.py -q && node --test tests-makers/domain.test.mjs
```

Output:

```text
....                                                                     [100%]
4 passed in 0.01s
✔ tests-makers/domain.test.mjs (107.695601ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 116.173116
```

## Self-review

- Confirmed exact threshold boundaries, unlimited level-unit search,
  monotonic marginal costs, base-four icon breakdown, zero normalization, and
  uncapped status in Python.
- Confirmed the equivalent Edge boundary and uncapped behavior plus the
  existing score/explosion contract.
- Confirmed `rankFor(300).emoji` is a complete emoji.
- Ran `git diff --check` on all Task 1 production, test, and documentation
  paths; it reported no whitespace errors.
- Reviewed status before committing; pre-existing staged frontend recipe-link
  files remain out of the Task 1 commit.

## Concerns

- The domain return shape deliberately removes the old finite-tier fields;
  dependent backend, edge routing, and frontend adaptation are handled by the
  follow-on tasks.
- At extremely high but safe Edge scores, the unbounded icon string can be
  large.  This follows the requested unlimited representation; no artificial
  presentation cap was added.
