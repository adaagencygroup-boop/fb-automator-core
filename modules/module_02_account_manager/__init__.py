"""Independent accounts plugin. Call initialize() from the host lifespan."""
from .plugin import initialize, shutdown

__all__ = ["initialize", "shutdown"]
