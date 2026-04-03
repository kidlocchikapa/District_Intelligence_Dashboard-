import logging
import pandas as pd
from datetime import datetime
from db_utils import get_session, log_etl_run

logger = logging.getLogger(__name__)

class WorldPopProcessor:
    def __init__(self, loader, engine):
        self.loader = loader
        self.engine = engine
        
    def process_tabular_data(self, df, source_filename):
        """
        Process WorldPop demographics data provided as CSV/Excel.
        Expected to merge with administrative boundaries and insert into worldpop_age_sex.
        """
        if df is None or df.empty:
            logger.warning("Empty dataframe provided to WorldPopProcessor.")
            return False
            
        logger.info(f"Processing WorldPop demographics from {source_filename}...")
        
        # Ensure we have start and end times for the task footprint
        df['start_time'] = datetime.now()
        df['end_time'] = datetime.now()
        df['execution_time'] = 0.0
        df['task_id'] = f"wp_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        df['dataset_name'] = df.get('dataset_name', 'wpgpas')
        
        # Harmonize column names explicitly for WorldPop if necessary
        rename_map = {
            "Admin_Unit": "admin_unit_name",
            "AdminUnit": "admin_unit_name",
            "Year": "worldpop_year",
            "Age_Class": "age_class",
            "Male": "male_population",
            "Female": "female_population",
            "Total": "total_population"
        }
        df = df.rename(columns=rename_map)
        
        # Clean col names
        df.columns = [str(c).lower().strip().replace(' ', '_') for c in df.columns]
        
        # Identify valid columns that align with our specific schema for worldpop_age_sex
        valid_cols = ['admin_unit_id', 'admin_unit_code', 'admin_unit_name', 'admin_unit_type',
                      'worldpop_year', 'dataset_name', 'age_class', 'age_label', 'male_population',
                      'female_population', 'total_population', 'task_id', 'start_time', 'end_time', 
                      'execution_time']
                      
        final_df = df[[c for c in df.columns if c in valid_cols]].copy()
        
        success = self.loader.to_table(
            df=final_df, 
            table_name='worldpop_age_sex', 
            source_filename=source_filename,
            dataset_type='demographics'
        )
        return success
