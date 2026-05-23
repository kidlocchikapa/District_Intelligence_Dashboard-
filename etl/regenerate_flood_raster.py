"""
Regenerate flood risk raster preview images without re-running the full
flood exposure analysis.

Usage:
    python regenerate_flood_raster.py --flood-raster /path/to/flood.tif
    python regenerate_flood_raster.py --flood-raster /path/to/flood.tif --district-name "Zomba City"
    python regenerate_flood_raster.py --flood-raster /path/to/flood.tif --district-name Zomba --district-name "Zomba City"

This reads district/TA boundaries from the database (same as the full pipeline)
and writes updated PNG + JSON files to frontend/public/worldpop/.
"""

# import standard libraries
import argparse
import logging
import os
import sys

# import third-party libraries
from dotenv import load_dotenv

from db_utils import get_session
from flood_exposure import (
    FloodPipelineError,
    fetch_district_and_ta_geometries,
    generate_flood_risk_previews,
    log_step,
    setup_logging,
)

LOGGER = logging.getLogger("regenerate_flood_raster")

# Default districts that cover the Zomba combined area
DEFAULT_DISTRICT_NAMES = ["Zomba", "Zomba City"]

# 
def parse_args():
    parser = argparse.ArgumentParser(
        description="Regenerate flood risk raster preview PNG and JSON metadata."
    )
    parser.add_argument(
        "--flood-raster",
        required=True,
        help="Path to the flood hazard GeoTIFF used in the original analysis.",
    )
    parser.add_argument(
        "--district-name",
        action="append",
        dest="district_names",
        default=[],
        metavar="NAME",
        help=(
            "District name to generate a preview for. "
            "Repeat the flag to include multiple districts in one combined preview. "
            f"Defaults to: {DEFAULT_DISTRICT_NAMES}"
        ),
    )
    parser.add_argument(
        "--all-zomba",
        action="store_true",
        default=False,
        help="Shortcut: generate a combined preview for Zomba + Zomba City.",
    )
    return parser.parse_args()

# Load boundaries and regenerate the raster preview 
def regenerate(flood_raster_path: str, district_names: list[str]) -> None:
    """Load boundaries and regenerate the raster preview for each district group."""
    if not os.path.exists(flood_raster_path):
        raise FileNotFoundError(
            f"Flood raster not found: {flood_raster_path}"
        )

    session = get_session()
    try:
        log_step("boundaries", f"fetching boundaries for: {district_names}")
        boundaries = fetch_district_and_ta_geometries(
            session=session,
            district_names=district_names,
        )

        primary_name = boundaries["district_name"]
        log_step("previews", f"generating preview for '{primary_name}'")
        generate_flood_risk_previews(
            flood_raster_path=flood_raster_path,
            district_name=primary_name,
            boundaries=boundaries,
        )

        # Resolve output path for user feedback
        script_dir = os.path.dirname(os.path.abspath(__file__))
        output_dir = os.path.abspath(
            os.path.join(script_dir, "..", "frontend", "public", "worldpop")
        )
        slug = (
            primary_name.lower()
            .replace(" ", "_")
            .replace("(", "")
            .replace(")", "")
        )
        print(f"\nDone. Files written to {output_dir}/")
        print(f"  flood_risk_{slug}.png")
        print(f"  flood_risk_{slug}.preview.json")
    finally:
        session.close()

# Main function to parse arguments, set up logging, and call the regeneration process
def main() -> None:
    load_dotenv()
    setup_logging()
    args = parse_args()

    district_names = args.district_names
    if args.all_zomba:
        district_names = DEFAULT_DISTRICT_NAMES
    if not district_names:
        district_names = DEFAULT_DISTRICT_NAMES

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_names: list[str] = []
    for name in district_names:
        if name not in seen:
            seen.add(name)
            unique_names.append(name)

    print(f"Regenerating flood raster preview for: {unique_names}")
    print(f"Flood raster: {args.flood_raster}\n")

    try:
        regenerate(
            flood_raster_path=args.flood_raster,
            district_names=unique_names,
        )
    except FloodPipelineError as exc:
        LOGGER.error(
            "Failed at step '%s': %s (original: %s)",
            exc.step_name,
            exc.user_message,
            exc.original_error,
        )
        sys.exit(f"Error: {exc.user_message}")
    except FileNotFoundError as exc:
        sys.exit(f"Error: {exc}")
    except Exception as exc:
        LOGGER.exception("Unexpected error during raster regeneration")
        sys.exit(f"Unexpected error: {exc}")


if __name__ == "__main__":
    main()
