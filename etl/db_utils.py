import datetime
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import SQLAlchemyError
from pipeline_config import DATABASE_URI

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_engine():
    """Returns a SQLAlchemy engine."""
    try:
        engine = create_engine(DATABASE_URI)
        return engine
    except Exception as e:
        logger.error(f"Failed to create database engine: {e}")
        raise

def get_session():
    """Returns a SQLAlchemy session."""
    engine = get_engine()
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return SessionLocal()

def log_etl_run(session, source_filename, source_type, dataset_type, table_name, 
                rows_read=0, rows_loaded=0, rows_flagged=0, status="Success", error_message=None):
    """Logs the ETL loading event into the data_load_log table."""
    try:
        # Build the exact SQL query avoiding full ORM models for simplicity
        sql = """
            INSERT INTO data_load_log (
                source_filename, source_type, dataset_type, table_name,
                rows_read, rows_loaded, rows_flagged, status, error_message,
                completed_at
            ) VALUES (
                :source_filename, :source_type, :dataset_type, :table_name,
                :rows_read, :rows_loaded, :rows_flagged, :status, :error_message,
                :completed_at
            )
        """
        params = {
            "source_filename": source_filename,
            "source_type": source_type,
            "dataset_type": dataset_type,
            "table_name": table_name,
            "rows_read": rows_read,
            "rows_loaded": rows_loaded,
            "rows_flagged": rows_flagged,
            "status": status,
            "error_message": error_message,
            "completed_at": datetime.datetime.now()
        }
        
        # Execute parameterized query
        from sqlalchemy import text
        session.execute(text(sql), params)
        session.commit()
    except Exception as e:
        logger.error(f"Failed to write ETL log: {e}")
        session.rollback()

