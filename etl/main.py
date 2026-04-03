import os
import argparse
import logging
from pipeline_config import RAW_DATA_DIR, MAPPINGS
from db_utils import get_engine
from ingest import DataIngestor
from transform import DataHarmonizer
from load import DatabaseLoader
from worldpop import WorldPopProcessor
from analytics import AnalyticsEngine

# Setup Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def run_etl_pipeline(target_files=None):
    logger.info("Initializing District Intelligence Dashboard ETL Pipeline")
    
    # Initialize Core Components
    engine = get_engine()
    ingestor = DataIngestor(raw_data_dir=RAW_DATA_DIR)
    harmonizer = DataHarmonizer(mappings=MAPPINGS)
    loader = DatabaseLoader()
    wp_processor = WorldPopProcessor(loader=loader, engine=engine)
    analytics = AnalyticsEngine(engine=engine)

    # Dictionary mapping filenames (or prefixes) to their respective dataset_type (DB Table)
    # This could also be provided via a json config map, but defaults mapped here
    file_registry = {
        'admin_units': 'administrative_units',
        'health': 'health_facilities',
        'schools': 'education_facilities',
        'welfare': 'welfare_beneficiaries',
        'worldpop': 'worldpop_age_sex'
    }

    # 1. Processing Loop If Target Files Provided (For testing/manual runs)
    if not target_files:
        logger.info(f"No specific files provided. Scanning {RAW_DATA_DIR}...")
        if os.path.exists(RAW_DATA_DIR):
            target_files = os.listdir(RAW_DATA_DIR)
        else:
            target_files = []
            logger.warning(f"Directory {RAW_DATA_DIR} does not exist.")

    for filename in target_files:
        # Prevent hidden files or directories
        if filename.startswith('.') or os.path.isdir(os.path.join(RAW_DATA_DIR, filename)):
            continue

        # Determine target dataset type based on filename prefix
        dataset_type = None
        for key, value in file_registry.items():
            if key in filename.lower():
                dataset_type = value
                break
        
        if not dataset_type:
            logger.info(f"Skipping {filename}: Could not determine target dataset type.")
            continue

        try:
            # 1. Extract
            raw_data = ingestor.read_file(filename)
            
            # Special case for WorldPop since it has unique demographic structure
            if dataset_type == 'worldpop_age_sex':
                wp_processor.process_tabular_data(raw_data, filename)
                continue

            # 2. Transform/Harmonize
            clean_data = harmonizer.process(raw_data, dataset_type)
            
            # 3. Load
            loader.to_table(clean_data, dataset_type, filename, dataset_type)
            
        except Exception as e:
            logger.error(f"Pipeline failed for {filename}: {e}")

    # 4. Analytics Run (Execute after storing all base layers)
    logger.info("Triggering standard Analytics workflow...")
    analytics.run_spatial_rollups()
    
    logger.info("ETL Pipeline Execution Completed.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="District Intelligence Dashboard ETL runner.")
    parser.add_argument('--files', nargs='+', help='List of specific files in sample_data to process.')
    parser.add_argument('--test-connection', action='store_true', help='Test database connection and exit.')
    args = parser.parse_args()

    if args.test_connection:
        try:
            get_engine().connect()
            print("Successfully connected to the database!")
        except Exception as e:
            print(f"Failed to connect: {e}")
    else:
        run_etl_pipeline(target_files=args.files)
