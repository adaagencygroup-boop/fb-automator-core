"""Database migrations for Module 7."""


def up() -> None:
    """Create the current PostgreSQL-only Module 7 schema."""
    from .migration_003_v2_campaign_runtime import up as run_003_up
    from .migration_004_remove_local_tables_from_cloud import up as run_004_up
    from .migration_005_cloud_first_logs import up as run_005_up
    from .migration_006_postgres_only import up as run_006_up

    run_003_up()
    run_004_up()
    run_005_up()
    run_006_up()


def down() -> None:
    """Remove the current Module 7 cloud schema."""
    from .migration_003_v2_campaign_runtime import down as run_003_down
    from .migration_004_remove_local_tables_from_cloud import down as run_004_down

    run_004_down()
    run_003_down()


__all__ = ["up", "down"]
