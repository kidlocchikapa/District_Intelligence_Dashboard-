#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


PALETTE_STOPS = np.array([0.0, 0.28, 0.48, 0.68, 0.84, 1.0], dtype=np.float32)
PALETTE_COLORS = np.array(
    [
        (255, 247, 138),
        (175, 240, 74),
        (92, 214, 97),
        (49, 170, 164),
        (40, 116, 214),
        (31, 35, 121),
    ],
    dtype=np.float32,
)


def read_geotiff(path: Path):
    image = Image.open(path)
    array = np.array(image, dtype=np.float32)

    scale = image.tag_v2.get(33550)
    tiepoint = image.tag_v2.get(33922)
    if not scale or not tiepoint:
        raise ValueError("GeoTIFF is missing georeferencing tags.")

    pixel_width = float(scale[0])
    pixel_height = float(scale[1])
    min_lon = float(tiepoint[3])
    max_lat = float(tiepoint[4])
    width, height = image.size
    max_lon = min_lon + width * pixel_width
    min_lat = max_lat - height * pixel_height

    return image, array, {
        "west": min_lon,
        "south": min_lat,
        "east": max_lon,
        "north": max_lat,
    }


def normalize_population_surface(array: np.ndarray, clip_percentile: float, gamma: float):
    valid_mask = np.isfinite(array) & (array > 0)
    if not np.any(valid_mask):
        raise ValueError("GeoTIFF does not contain positive population values.")

    valid = array[valid_mask]
    clip_max = float(np.percentile(valid, clip_percentile))
    clipped = np.clip(array, 0, clip_max)
    normalized = np.log1p(clipped) / np.log1p(clip_max)
    normalized = np.power(normalized, gamma, where=normalized >= 0)
    normalized[~valid_mask] = 0

    return normalized.astype(np.float32), valid_mask, clip_max


def colorize(normalized: np.ndarray, valid_mask: np.ndarray):
    red = np.interp(normalized, PALETTE_STOPS, PALETTE_COLORS[:, 0])
    green = np.interp(normalized, PALETTE_STOPS, PALETTE_COLORS[:, 1])
    blue = np.interp(normalized, PALETTE_STOPS, PALETTE_COLORS[:, 2])

    rgba = np.zeros((*normalized.shape, 4), dtype=np.uint8)
    rgba[..., 0] = np.round(red).astype(np.uint8)
    rgba[..., 1] = np.round(green).astype(np.uint8)
    rgba[..., 2] = np.round(blue).astype(np.uint8)
    rgba[..., 3] = np.where(valid_mask, 255, 0).astype(np.uint8)

    return Image.fromarray(rgba, mode="RGBA")


def resize_preview(image: Image.Image, max_height: int):
    if image.height <= max_height:
        return image

    scale = max_height / image.height
    width = max(1, int(round(image.width * scale)))
    return image.resize((width, max_height), Image.Resampling.BILINEAR)


def write_metadata(path: Path, bounds: dict, clip_max: float, source_path: Path):
    metadata = {
        "source": str(source_path),
        "image": path.with_suffix(".png").name,
        "bounds": [
            [bounds["south"], bounds["west"]],
            [bounds["north"], bounds["east"]],
        ],
        "legend": {
            "label": "Estimated people per grid cell",
            "lowLabel": "Low",
            "highLabel": "High",
            "colors": [
                "#fff78a",
                "#aff04a",
                "#5cd661",
                "#31aaa4",
                "#2874d6",
                "#1f2379",
            ],
        },
        "render": {
            "clipPercentile": 99.85,
            "clipMax": clip_max,
            "transform": "log1p",
            "gamma": 0.85,
        },
    }
    path.write_text(json.dumps(metadata, indent=2))


def main():
    parser = argparse.ArgumentParser(
        description="Create a styled PNG preview from a WorldPop GeoTIFF."
    )
    parser.add_argument("--input", required=True, help="Path to the source GeoTIFF")
    parser.add_argument("--output", required=True, help="Path to the output PNG")
    parser.add_argument(
        "--metadata",
        required=True,
        help="Path to the output metadata JSON",
    )
    parser.add_argument(
        "--max-height",
        type=int,
        default=2400,
        help="Maximum preview image height in pixels",
    )
    parser.add_argument(
        "--clip-percentile",
        type=float,
        default=99.85,
        help="Upper percentile used before log scaling",
    )
    parser.add_argument(
        "--gamma",
        type=float,
        default=0.85,
        help="Gamma applied after log scaling",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    metadata_path = Path(args.metadata).expanduser().resolve()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    _, array, bounds = read_geotiff(input_path)
    normalized, valid_mask, clip_max = normalize_population_surface(
        array,
        clip_percentile=args.clip_percentile,
        gamma=args.gamma,
    )
    preview = colorize(normalized, valid_mask)
    preview = resize_preview(preview, args.max_height)
    preview.save(output_path, optimize=True)
    write_metadata(metadata_path, bounds, clip_max, input_path)

    print(json.dumps({
        "output": str(output_path),
        "metadata": str(metadata_path),
        "bounds": bounds,
        "size": preview.size,
        "clip_max": clip_max,
    }, indent=2))


if __name__ == "__main__":
    main()
