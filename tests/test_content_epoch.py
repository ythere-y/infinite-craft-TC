from __future__ import annotations

import asyncio
import sqlite3

import pytest

from backend import (
    archive,
    community,
    content_catalog,
    content_epoch,
    db,
    main,
)


GAMEPLAY_TABLES = (
    "formula_votes",
    "result_votes",
    "formula_reproductions",
    "formula_moderation",
    "formula_versions",
    "retired_combo_keys",
    "combinations",
    "elements",
    "first_discoveries",
    "kpi_events",
    "nicknames",
)


class FakePipeline:
    def __init__(self, redis: "FakeRedis") -> None:
        self.redis = redis
        self.commands: list[tuple[str, tuple[str, ...]]] = []

    def delete(self, *keys: str) -> "FakePipeline":
        self.commands.append(("delete", keys))
        return self

    def execute(self) -> list[int]:
        return [
            self.redis.delete(*keys)
            for command, keys in self.commands
            if command == "delete"
        ]


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.flush_count = 0

    def ping(self) -> bool:
        return True

    def dbsize(self) -> int:
        return len(self.values)

    def flushdb(self) -> bool:
        self.values.clear()
        self.flush_count += 1
        return True

    def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            if key in self.values:
                del self.values[key]
                deleted += 1
        return deleted

    def hgetall(self, key: str) -> dict[str, object]:
        value = self.values.get(key)
        return dict(value) if isinstance(value, dict) else {}

    def pipeline(self) -> FakePipeline:
        return FakePipeline(self)


def use_temp_archive(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")


def current_catalog_state() -> tuple[int, str]:
    compiled = content_catalog.load_compiled_content()
    return compiled["content_epoch"], compiled["catalog_digest"]


def table_counts() -> dict[str, int]:
    con = archive._conn()
    try:
        return {
            table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in GAMEPLAY_TABLES
        }
    finally:
        con.close()


def test_legacy_data_is_hard_reset_once(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.upsert_combination(
        "打工鹅 + 时间", "美团", "🛵", "seed", "invest"
    )
    archive.upsert_element("美团", "🛵", "invest", source="seed")
    fake = FakeRedis()
    fake.values["combo:打工鹅 + 时间"] = {"result": "美团"}
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "epoch_reset"
    assert archive.all_combinations() == []
    assert archive.all_elements() == []
    assert fake.values == {}
    assert fake.flush_count == 1
    assert archive.content_state()["status"] == "migrating"
    assert archive.content_state()["phase"] == "epoch_reset"

    content_epoch.complete_local()
    second = content_epoch.prepare_local()
    assert second.mode == "ready"
    assert fake.flush_count == 1


def test_matching_epoch_and_digest_starts_nondestructive_reconciliation(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    epoch, digest = current_catalog_state()
    archive.complete_content_migration(epoch, digest)
    archive.upsert_combination("甲 + 乙", "动态结果", "📦", "llm", "ai")
    fake = FakeRedis()
    fake.values["combo:甲 + 乙"] = {"result": "动态结果"}
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "ready"
    assert archive.all_combinations()[0]["result"] == "动态结果"
    assert fake.values["combo:甲 + 乙"] == {"result": "动态结果"}
    assert fake.flush_count == 0
    state = archive.content_state()
    assert state["status"] == "migrating"
    assert state["phase"] == "reconcile"
    assert state["error"] == ""


def test_missing_state_with_redis_data_is_authorized_legacy_reset(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    assert archive.content_state() is None
    assert archive.has_gameplay_data() is False
    fake = FakeRedis()
    fake.values["stale"] = "runtime"
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "epoch_reset"
    assert fake.values == {}
    assert fake.flush_count == 1
    state = archive.content_state()
    assert state["status"] == "migrating"
    assert state["phase"] == "epoch_reset"


def test_empty_legacy_store_bootstraps_without_prior_epoch_authorization(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "bootstrap"
    assert fake.flush_count == 1
    state = archive.content_state()
    assert state["status"] == "migrating"
    assert state["phase"] == "bootstrap"


def test_authorized_epoch_one_resets_even_when_sqlite_is_empty(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    _, digest = current_catalog_state()
    archive.complete_content_migration(1, digest)
    fake = FakeRedis()
    fake.values["stale"] = 1
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "epoch_reset"
    assert fake.values == {}
    assert fake.flush_count == 1
    state = archive.content_state()
    epoch, current_digest = current_catalog_state()
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == current_digest
    assert state["status"] == "migrating"


def test_higher_epoch_fails_before_any_local_write_or_delete(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    _, digest = current_catalog_state()
    archive.complete_content_migration(3, digest)
    archive.upsert_combination("甲 + 乙", "未来数据", "📦", "llm", "ai")
    fake = FakeRedis()
    fake.values["combo:甲 + 乙"] = {"result": "未来数据"}
    monkeypatch.setattr(db, "get_client", lambda: fake)
    state_before = archive.content_state()

    with pytest.raises(
        content_epoch.ContentResetNotAuthorized,
        match="CONTENT_RESET_NOT_AUTHORIZED",
    ):
        content_epoch.prepare_local()

    assert archive.content_state() == state_before
    assert archive.all_combinations()[0]["result"] == "未来数据"
    assert fake.values == {"combo:甲 + 乙": {"result": "未来数据"}}
    assert fake.flush_count == 0


def test_unauthorized_lower_epoch_fails_before_local_write_or_delete(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    compiled = content_catalog.load_compiled_content()
    archive.complete_content_migration(1, compiled["catalog_digest"])
    archive.upsert_combination("甲 + 乙", "保留数据", "📦", "llm", "ai")
    fake = FakeRedis()
    fake.values["combo:甲 + 乙"] = {"result": "保留数据"}
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(
        content_catalog,
        "load_compiled_content",
        lambda: {**compiled, "destructive_reset_from": ["legacy"]},
    )
    state_before = archive.content_state()

    with pytest.raises(
        content_epoch.ContentResetNotAuthorized,
        match="CONTENT_RESET_NOT_AUTHORIZED",
    ):
        content_epoch.prepare_local()

    assert archive.content_state() == state_before
    assert archive.all_combinations()[0]["result"] == "保留数据"
    assert fake.values == {"combo:甲 + 乙": {"result": "保留数据"}}
    assert fake.flush_count == 0


def test_policy_failure_reporting_does_not_mutate_an_older_migration(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    _, digest = current_catalog_state()
    archive.begin_content_migration(3, digest, "epoch_reset")
    fake = FakeRedis()
    fake.values["future"] = "keep"
    monkeypatch.setattr(db, "get_client", lambda: fake)
    state_before = archive.content_state()

    with pytest.raises(content_epoch.ContentResetNotAuthorized) as raised:
        content_epoch.prepare_local()
    content_epoch.fail_local(raised.value)

    assert archive.content_state() == state_before
    assert fake.values == {"future": "keep"}
    assert fake.flush_count == 0


def test_failed_seed_load_leaves_migration_resumable(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.upsert_combination(
        "旧左 + 旧右", "旧结果", "🧹", "llm", "ai"
    )
    fake = FakeRedis()
    fake.values["combo:旧左 + 旧右"] = {"result": "旧结果"}
    monkeypatch.setattr(db, "get_client", lambda: fake)

    first = content_epoch.prepare_local()
    assert first.mode == "epoch_reset"
    assert archive.content_state()["status"] == "migrating"

    archive.upsert_combination(
        "半成品左 + 半成品右", "半成品", "🚧", "seed", "test"
    )
    fake.values["combo:半成品左 + 半成品右"] = {"result": "半成品"}
    resumed = content_epoch.prepare_local()

    assert resumed.mode == "resume"
    assert archive.all_combinations() == []
    assert fake.values == {}
    assert fake.flush_count == 2
    assert archive.content_state()["status"] == "migrating"

    content_epoch.complete_local()
    state = archive.content_state()
    epoch, digest = current_catalog_state()
    assert state["status"] == "ready"
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == digest


def test_migrating_older_target_forces_current_epoch_reset(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    epoch, digest = current_catalog_state()
    archive.begin_content_migration(
        epoch - 1,
        "sha256:" + "1" * 64,
        "differential",
    )
    archive.upsert_combination("甲 + 乙", "旧数据", "📦", "llm", "ai")
    fake = FakeRedis()
    fake.values["combo:甲 + 乙"] = {
        "result": "旧数据",
        "source": "llm",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "epoch_reset"
    assert archive.all_combinations() == []
    assert fake.values == {}
    assert fake.flush_count == 1
    state = archive.content_state()
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == digest
    assert state["phase"] == "epoch_reset"


@pytest.mark.parametrize("phase", ["epoch_reset", "bootstrap"])
def test_migrating_stale_digest_keeps_destructive_phase(
    tmp_path, monkeypatch, phase
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    compiled = content_catalog.load_compiled_content()
    epoch = compiled["content_epoch"]
    digest = compiled["catalog_digest"]
    retired_pair = compiled["retired_pairs"][0]
    archive.begin_content_migration(
        epoch,
        "sha256:" + "2" * 64,
        phase,
    )
    archive.upsert_combination(
        retired_pair, "旧固定结果", "🧹", "seed", "generated"
    )
    archive.upsert_combination("甲 + 乙", "玩家结果", "🧑", "llm", "ai")
    fake = FakeRedis()
    fake.values[f"combo:{retired_pair}"] = {
        "result": "旧固定结果",
        "source": "seed",
    }
    fake.values["combo:甲 + 乙"] = {
        "result": "玩家结果",
        "source": "llm",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == phase
    assert fake.flush_count == 1
    assert fake.values == {}
    assert archive.all_combinations() == []
    state = archive.content_state()
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == digest
    assert state["phase"] == phase


def test_migrating_stale_differential_restarts_for_current_digest(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    compiled = content_catalog.load_compiled_content()
    epoch = compiled["content_epoch"]
    digest = compiled["catalog_digest"]
    retired_pair = compiled["retired_pairs"][0]
    archive.begin_content_migration(
        epoch,
        "sha256:" + "2" * 64,
        "differential",
    )
    archive.upsert_combination(
        retired_pair, "旧固定结果", "🧹", "seed", "generated"
    )
    archive.upsert_combination("甲 + 乙", "玩家结果", "🧑", "llm", "ai")
    fake = FakeRedis()
    fake.values[f"combo:{retired_pair}"] = {
        "result": "旧固定结果",
        "source": "seed",
    }
    fake.values["combo:甲 + 乙"] = {
        "result": "玩家结果",
        "source": "llm",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "differential"
    assert fake.flush_count == 0
    assert f"combo:{retired_pair}" not in fake.values
    assert fake.values["combo:甲 + 乙"]["result"] == "玩家结果"
    combinations = {row["key"]: row for row in archive.all_combinations()}
    assert retired_pair not in combinations
    assert combinations["甲 + 乙"]["source"] == "llm"
    state = archive.content_state()
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == digest
    assert state["phase"] == "differential"


def test_same_epoch_digest_change_retires_only_fixed_content(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    compiled = content_catalog.load_compiled_content()
    epoch = compiled["content_epoch"]
    retired_seed_pair, retired_dynamic_pair = compiled["retired_pairs"][:2]
    retired_seed_element, retired_dynamic_element = compiled[
        "retired_elements"
    ][:2]
    archive.complete_content_migration(epoch, "sha256:" + "0" * 64)

    archive.upsert_combination(
        retired_seed_pair, "旧固定结果", "🧹", "seed", "generated"
    )
    archive.upsert_combination(
        retired_dynamic_pair, "玩家结果", "🧑", "llm", "dynamic"
    )
    archive.upsert_combination(
        "甲 + 乙", "保留结果", "📦", "seed", "base"
    )
    archive.upsert_element(
        retired_seed_element,
        "🧹",
        "generated",
        source="seed",
    )
    archive.upsert_element(
        retired_dynamic_element,
        "🧑",
        "dynamic",
        source="llm",
    )
    archive.upsert_element("玩家元素", "🧑", "dynamic", source="llm")
    formula = community.ensure_formula(
        "玩家左 + 玩家右",
        "玩家左",
        "玩家右",
        "玩家公式",
        "🧑",
        "保留用户内容",
        "llm",
        "玩家",
    )

    fake = FakeRedis()
    fake.values[f"combo:{retired_seed_pair}"] = {
        "result": "旧固定结果",
        "source": "seed",
    }
    fake.values[f"combo:{retired_dynamic_pair}"] = {
        "result": "玩家结果",
        "source": "llm",
    }
    fake.values["combo:甲 + 乙"] = {
        "result": "保留结果",
        "source": "seed",
    }
    fake.values["nick:玩家"] = "1"
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "differential"
    assert fake.flush_count == 0
    assert f"combo:{retired_seed_pair}" not in fake.values
    assert fake.values[f"combo:{retired_dynamic_pair}"] == {
        "result": "玩家结果",
        "source": "llm",
    }
    assert fake.values["combo:甲 + 乙"] == {
        "result": "保留结果",
        "source": "seed",
    }
    assert fake.values["nick:玩家"] == "1"

    combinations = {row["key"]: row for row in archive.all_combinations()}
    assert retired_seed_pair not in combinations
    assert combinations[retired_dynamic_pair]["source"] == "llm"
    assert combinations["甲 + 乙"]["source"] == "seed"
    elements = {row["name"]: row for row in archive.all_elements()}
    assert retired_seed_element not in elements
    assert elements[retired_dynamic_element]["source"] == "llm"
    assert elements["玩家元素"]["source"] == "llm"
    assert community.public_formula(formula["id"]) is None
    con = archive._conn()
    try:
        assert con.execute(
            "SELECT COUNT(*) FROM formula_versions WHERE id=?",
            (formula["id"],),
        ).fetchone()[0] == 1
    finally:
        con.close()
    assert archive.content_state()["phase"] == "differential"
    assert archive.content_state()["status"] == "migrating"


def test_redis_retirement_treats_missing_source_as_legacy_seed(monkeypatch):
    compiled = content_catalog.load_compiled_content()
    legacy_pair, dynamic_pair = compiled["retired_pairs"][:2]
    fake = FakeRedis()
    fake.values[f"combo:{legacy_pair}"] = {"result": "旧固定结果"}
    fake.values[f"combo:{dynamic_pair}"] = {
        "result": "玩家结果",
        "source": "llm",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    db.delete_combo_keys({legacy_pair, dynamic_pair})

    assert f"combo:{legacy_pair}" not in fake.values
    assert fake.values[f"combo:{dynamic_pair}"] == {
        "result": "玩家结果",
        "source": "llm",
    }


def test_sqlite_reset_clears_every_gameplay_table_but_preserves_state_and_config(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    epoch, digest = current_catalog_state()
    archive.complete_content_migration(epoch, digest)
    archive.upsert_combination("甲 + 乙", "结果", "📦", "llm", "ai")
    archive.upsert_element("结果", "📦", "ai", source="llm")
    archive.record_first_archive("结果", "📦", "玩家", 1.0)
    archive.kpi_archive("session", 10, "test")
    archive.nickname_archive("玩家")
    formula = community.ensure_formula(
        "甲 + 乙", "甲", "乙", "结果", "📦", "点评", "llm", "玩家"
    )
    con = archive._conn()
    try:
        con.executescript(
            """
            CREATE TABLE app_config (name TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO app_config VALUES ('keep', 'yes');
            """
        )
        con.execute(
            "INSERT INTO formula_reproductions VALUES (?, ?, ?)",
            (formula["id"], "玩家", 1.0),
        )
        con.execute(
            "INSERT INTO formula_votes VALUES (?, ?, ?, ?)",
            (formula["id"], "玩家", 1, 1.0),
        )
        con.execute(
            "INSERT INTO result_votes VALUES (?, ?, ?, ?)",
            ("结果", "玩家", 1, 1.0),
        )
        con.execute(
            """
            INSERT INTO formula_moderation(
                formula_id, actor, action, reason_code, note, created_at
            ) VALUES (?, 'admin', 'keep', 'test', '', 1.0)
            """,
            (formula["id"],),
        )
        con.execute(
            "INSERT INTO retired_combo_keys VALUES (?, ?, ?, ?)",
            ("旧左 + 旧右", 1, "旧结果", 1.0),
        )
        con.commit()
    finally:
        con.close()
    assert all(value > 0 for value in table_counts().values())

    archive.reset_gameplay_data()

    assert table_counts() == {table: 0 for table in GAMEPLAY_TABLES}
    state = archive.content_state()
    assert state["status"] == "ready"
    assert state["epoch"] == epoch
    con = archive._conn()
    try:
        assert con.execute(
            "SELECT value FROM app_config WHERE name='keep'"
        ).fetchone()[0] == "yes"
    finally:
        con.close()


def test_reset_failure_rolls_back_gameplay_and_keeps_migrating_marker(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.upsert_combination("甲 + 乙", "结果", "📦", "llm", "ai")
    formula = community.ensure_formula(
        "甲 + 乙", "甲", "乙", "结果", "📦", "点评", "llm", "玩家"
    )
    con = archive._conn()
    try:
        con.execute(
            "INSERT INTO formula_votes VALUES (?, ?, ?, ?)",
            (formula["id"], "玩家", 1, 1.0),
        )
        con.execute(
            """
            CREATE TRIGGER abort_combination_delete
            BEFORE DELETE ON combinations
            BEGIN
                SELECT RAISE(ABORT, 'simulated crash');
            END
            """
        )
        con.commit()
    finally:
        con.close()
    fake = FakeRedis()
    fake.values["combo:甲 + 乙"] = {"result": "结果"}
    monkeypatch.setattr(db, "get_client", lambda: fake)

    with pytest.raises(sqlite3.IntegrityError, match="simulated crash"):
        content_epoch.prepare_local()

    assert archive.content_state()["status"] == "migrating"
    assert archive.content_state()["phase"] == "epoch_reset"
    counts = table_counts()
    assert counts["formula_votes"] == 1
    assert counts["combinations"] == 1
    assert fake.flush_count == 0
    assert fake.values["combo:甲 + 乙"] == {"result": "结果"}


def test_startup_failure_resumes_before_marking_content_ready(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    fake = FakeRedis()
    fake.values["stale"] = "runtime"
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(main, "load_prompt_spec", lambda: {})
    monkeypatch.setattr(
        main.db,
        "warm_up_from_archive",
        lambda: (_ for _ in ()).throw(
            AssertionError("migration startup must not warm archived content")
        ),
    )
    monkeypatch.setattr(
        main.store,
        "load",
        lambda: (_ for _ in ()).throw(RuntimeError("seed load failed")),
    )

    with pytest.raises(RuntimeError, match="seed load failed"):
        asyncio.run(main._startup())

    failed_state = archive.content_state()
    assert failed_state["status"] == "migrating"
    assert "seed load failed" in failed_state["error"]
    assert fake.flush_count == 1

    monkeypatch.setattr(main.store, "load", lambda: (0, 0))
    monkeypatch.setattr(main.depth_mod, "warm_up_from_seed", lambda: {})
    asyncio.run(main._startup())

    state = archive.content_state()
    epoch, digest = current_catalog_state()
    assert state["status"] == "ready"
    assert state["epoch"] == epoch
    assert state["catalog_digest"] == digest
    assert fake.flush_count == 2


def test_depth_replacement_failure_does_not_mark_content_ready(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(main, "load_prompt_spec", lambda: {})
    monkeypatch.setattr(main.store, "load", lambda: (1, 1))
    monkeypatch.setattr(
        main.depth_mod,
        "warm_up_from_seed",
        lambda: (_ for _ in ()).throw(RuntimeError("depth replace failed")),
    )

    with pytest.raises(RuntimeError, match="depth replace failed"):
        asyncio.run(main._startup())

    state = archive.content_state()
    assert state["status"] == "migrating"
    assert state["phase"] == "bootstrap"
    assert "depth replace failed" in state["error"]


@pytest.mark.parametrize("stage", ["warmup", "seed", "depth"])
def test_matching_ready_startup_failure_is_durable(
    tmp_path, monkeypatch, stage
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    epoch, digest = current_catalog_state()
    archive.complete_content_migration(epoch, digest)
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(main, "load_prompt_spec", lambda: {})

    def warmup():
        if stage == "warmup":
            raise RuntimeError("warmup failed")
        return {"combos": 0, "firsts": 0, "nicks": 0}

    def seed_load():
        if stage == "seed":
            raise RuntimeError("seed failed")
        return 1, 1

    def depth_load():
        if stage == "depth":
            raise RuntimeError("depth failed")
        return {}

    monkeypatch.setattr(main.db, "warm_up_from_archive", warmup)
    monkeypatch.setattr(main.store, "load", seed_load)
    monkeypatch.setattr(main.depth_mod, "warm_up_from_seed", depth_load)

    with pytest.raises(RuntimeError, match=f"{stage} failed"):
        asyncio.run(main._startup())

    state = archive.content_state()
    assert state["status"] == "migrating"
    assert state["phase"] == "reconcile"
    assert f"{stage} failed" in state["error"]
    assert state["completed_at"] is None
    assert fake.flush_count == 0


def test_failed_ready_reconciliation_resumes_without_reset(
    tmp_path, monkeypatch
):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    epoch, digest = current_catalog_state()
    archive.complete_content_migration(epoch, digest)
    archive.upsert_combination("甲 + 乙", "玩家结果", "🧑", "llm", "ai")
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(main, "load_prompt_spec", lambda: {})
    calls = 0

    def warmup():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient warmup failure")
        return {"combos": 0, "firsts": 0, "nicks": 0}

    monkeypatch.setattr(main.db, "warm_up_from_archive", warmup)
    monkeypatch.setattr(main.store, "load", lambda: (1, 1))
    monkeypatch.setattr(main.depth_mod, "warm_up_from_seed", lambda: {})

    with pytest.raises(RuntimeError, match="transient warmup failure"):
        asyncio.run(main._startup())
    assert archive.content_state()["status"] == "migrating"

    asyncio.run(main._startup())

    assert calls == 2
    assert fake.flush_count == 0
    assert archive.all_combinations()[0]["result"] == "玩家结果"
    state = archive.content_state()
    assert state["status"] == "ready"
    assert state["error"] == ""


def test_health_exposes_durable_content_state(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    epoch, digest = current_catalog_state()
    archive.complete_content_migration(epoch, digest)
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)

    result = asyncio.run(main.api_health())

    assert result["content"] == {
        "epoch": epoch,
        "catalog_digest": digest,
        "status": "ready",
    }
