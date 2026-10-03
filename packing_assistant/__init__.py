"""Smart Packing Assistant: 3D suitcase packing optimiser."""

from .data_io import load_trip
from .models import Item, Placement, Suitcase
from .optimizer import (
    MultiPackingResult, PackerConfig, PackingOptimizer, PackingResult, pack, pack_bags,
)

__all__ = [
    "Item",
    "Placement",
    "Suitcase",
    "PackerConfig",
    "PackingOptimizer",
    "PackingResult",
    "MultiPackingResult",
    "pack",
    "pack_bags",
    "load_trip",
]
__version__ = "0.4.0"
