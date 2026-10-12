"""Database migrations for Module 7."""


def up() -> None:
    """Apply all Module 7 schema migrations in order."""
    from .migration_001_schema import up as run_001_up
    from .migration_002_module2_account import up as run_002_up

    run_001_up()
    run_002_up()


def down() -> None:
    """Roll back all Module 7 schema migrations in reverse order."""
    from .migration_001_schema import down as run_001_down
    from .migration_002_module2_account import down as run_002_down

    run_002_down()
    run_001_down()


__all__ = ["up", "down"]
