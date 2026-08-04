"""Crash-resumable local SQLite and Redis content epoch migration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import archive, content_catalog, db


@dataclass(frozen=True)
class MigrationDecision:
    mode: str
    phase: str


def _catalog_state() -> dict[str, Any]:
    compiled = content_catalog.load_compiled_content()
    return {
        "epoch": int(compiled["content_epoch"]),
        "catalog_digest": str(compiled["catalog_digest"]),
        "retired_pairs": set(compiled["retired_pairs"]),
        "retired_elements": set(compiled["retired_elements"]),
    }


def _apply_migration(phase: str, catalog: dict[str, Any]) -> None:
    if phase == "reconcile":
        return
    if phase in {"epoch_reset", "bootstrap"}:
        if archive.has_gameplay_data():
            archive.reset_gameplay_data()
        db.reset_runtime_data()
        return
    if phase == "differential":
        archive.retire_fixed_content(
            catalog["retired_pairs"],
            catalog["retired_elements"],
        )
        db.delete_combo_keys(catalog["retired_pairs"])
        return
    raise ValueError(f"unknown local content migration phase: {phase}")


def prepare_local() -> MigrationDecision:
    catalog = _catalog_state()
    state = archive.content_state()

    if state and state["status"] == "migrating":
        if state["epoch"] != catalog["epoch"]:
            phase = "epoch_reset"
            mode = phase
        elif state["catalog_digest"] != catalog["catalog_digest"]:
            stored_phase = str(state["phase"])
            if stored_phase in {"epoch_reset", "bootstrap"}:
                phase = stored_phase
            elif stored_phase in {"differential", "reconcile"}:
                phase = "differential"
            else:
                phase = "epoch_reset"
            mode = phase
        else:
            phase = str(state["phase"])
            mode = "resume"
        archive.begin_content_migration(
            catalog["epoch"],
            catalog["catalog_digest"],
            phase,
        )
        _apply_migration(phase, catalog)
        return MigrationDecision(mode=mode, phase=phase)

    if (
        state
        and state["status"] == "ready"
        and state["epoch"] == catalog["epoch"]
        and state["catalog_digest"] == catalog["catalog_digest"]
    ):
        archive.begin_content_migration(
            catalog["epoch"],
            catalog["catalog_digest"],
            "reconcile",
        )
        return MigrationDecision(mode="ready", phase="reconcile")

    if state is None:
        phase = "epoch_reset" if archive.has_gameplay_data() else "bootstrap"
    elif state["epoch"] == catalog["epoch"]:
        phase = "differential"
    else:
        phase = "epoch_reset"

    archive.begin_content_migration(
        catalog["epoch"],
        catalog["catalog_digest"],
        phase,
    )
    _apply_migration(phase, catalog)
    return MigrationDecision(mode=phase, phase=phase)


def complete_local() -> None:
    catalog = _catalog_state()
    archive.complete_content_migration(
        catalog["epoch"],
        catalog["catalog_digest"],
    )


def fail_local(error: BaseException | str) -> None:
    if isinstance(error, BaseException):
        message = f"{type(error).__name__}: {error}"
    else:
        message = str(error)
    archive.fail_content_migration(
        (message.strip() or "local content startup failed")[:1000]
    )


def health_status() -> dict[str, Any]:
    catalog = _catalog_state()
    state = archive.content_state()
    if state is None:
        return {
            "epoch": catalog["epoch"],
            "catalog_digest": catalog["catalog_digest"],
            "status": "missing",
        }
    return {
        "epoch": state["epoch"],
        "catalog_digest": state["catalog_digest"],
        "status": state["status"],
    }
