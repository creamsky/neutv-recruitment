from __future__ import annotations

from pathlib import Path
import shutil

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "assets" / "brand"


def remove_white_background(source: Path, destination: Path) -> None:
    """Convert a white-backed single-color logo to a clean alpha cutout.

    The foreground color is estimated from the darkest source pixels, then the
    alpha channel is reconstructed from the original white compositing. This
    preserves the source silhouette without asking a generative model to
    redraw protected brand artwork.
    """

    image = Image.open(source).convert("RGB")
    rgb = np.asarray(image, dtype=np.float32)

    core = rgb[np.min(rgb, axis=2) < 100]
    if not core.size:
        raise ValueError(f"Could not find foreground pixels in {source}")

    foreground = np.median(core, axis=0)
    denominators = np.maximum(255.0 - foreground, 1.0)
    alpha_candidates = (255.0 - rgb) / denominators
    alpha = np.median(alpha_candidates, axis=2)
    alpha = np.clip((alpha - 0.008) / 0.985, 0.0, 1.0)
    alpha[alpha < 0.015] = 0.0
    alpha[alpha > 0.985] = 1.0

    solid = np.broadcast_to(np.round(foreground), rgb.shape)
    rgba = np.dstack((solid, np.round(alpha * 255.0))).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(destination, optimize=True)


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)

    remove_white_background(
        ROOT / "NEUTV_logo.jpg",
        BRAND_DIR / "neutv-logo-transparent.png",
    )

    shutil.copy2(
        ROOT / "标识" / "校徽.png",
        BRAND_DIR / "neu-emblem.png",
    )

    print(BRAND_DIR / "neutv-logo-transparent.png")
    print(BRAND_DIR / "neu-emblem.png")


if __name__ == "__main__":
    main()
