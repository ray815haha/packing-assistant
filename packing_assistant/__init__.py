"""Smart Packing Assistant: 3D suitcase packing optimiser."""

from .data_io import load_trip
from .models import Item, Placement, Suitcase
from .optimizer import PackerConfig, PackingOptimizer, PackingResult, pack

__all__ = [
    "Item",
    "Placement",
    "Suitcase",
    "PackerConfig",
    "PackingOptimizer",
    "PackingResult",
    "pack",
    "load_trip",
]
__version__ = "0.1.0"
