from sqlalchemy import text
import geopandas as gpd
import pandas as pd
import logging
from db_utils import get_engine, get_session, log_etl_run

logger = logging.getLogger(__name__)

class DatabaseLoader:
    def __init__(self):
        self.engine = get_engine()

    def to_table(self, df, table_name, source_filename, dataset_type):
        """
        Loads the pandas/geopandas dataframe into the target database table.
        Logs the process to the data_load_log.
        """
        if df is None or df.empty:
            logger.warning(f"No data to load for {table_name}")
            return False

        rows_read = len(df)
        session = get_session()
        
        try:
            logger.info(f"Loading {rows_read} records into {table_name}...")
            
            # Using append so we don't overwrite schema, which drops indexes!
            if isinstance(df, gpd.GeoDataFrame):
                # We need geoalchemy2 and geopandas mapped correctly
                # to_postgis natively handles inserting geometry objects into PostGIS
                df.to_postgis(
                    name=table_name,
                    con=self.engine,
                    if_exists='append',
                    index=False
                )
            else:
                # Tabular data only
                df.to_sql(
                    name=table_name,
                    con=self.engine,
                    if_exists='append',
                    index=False
                )
            
            logger.info(f"Successfully loaded {table_name}.")
            
            # Log success
            log_etl_run(
                session=session,
                source_filename=source_filename,
                source_type="file",
                dataset_type=dataset_type,
                table_name=table_name,
                rows_read=rows_read,
                rows_loaded=rows_read,
                status="Success"
            )
            return True
            
        except Exception as e:
            logger.error(f"Failed to load data into {table_name}: {e}")
            # Log Failure
            log_etl_run(
                session=session,
                source_filename=source_filename,
                source_type="file",
                dataset_type=dataset_type,
                table_name=table_name,
                rows_read=rows_read,
                rows_loaded=0,
                status="Failed",
                error_message=str(e)
            )
            return False
        finally:
            session.close()

