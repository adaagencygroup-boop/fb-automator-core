"""Database migrations for Module 7."""


def up() -> None:
    """Create the current Module 7 local and cloud schemas."""
    from .migration_003_v2_campaign_runtime import up as run_003_up
    from .migration_004_remove_local_tables_from_cloud import up as run_004_up

    run_003_up()
    run_004_up()


def down() -> None:
    """Remove the current Module 7 local and cloud schemas."""
    from .migration_003_v2_campaign_runtime import down as run_003_down
    from .migration_004_remove_local_tables_from_cloud import down as run_004_down

    run_004_down()
    run_003_down()


__all__ = ["up", "down"]
