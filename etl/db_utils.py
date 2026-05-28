##import libaries
import json
import os
import re
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

#Loaad environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

# Normalize connection strings loaded from .env so accidental whitespace
# does not break remote database connections.
def normalize_database_url(connection_string):
    cleaned = connection_string.strip()
    cleaned = re.sub(r"\s+\?", "?", cleaned)
    cleaned = cleaned.replace(
        "?sslmode=require&channel_binding=require",
        "?sslmode=require",
    )
    return cleaned


# build database url from environment variables, prioritizing DATABASE_URL if set, otherwise constructing from individual components
def build_database_url():
    explicit_url = os.getenv('DATABASE_URL')
    if explicit_url:
        return normalize_database_url(explicit_url)

    db_user = os.getenv('DB_USER')
    db_password = os.getenv('DB_PASSWORD')
    db_name = os.getenv('DB_NAME')
    db_host = os.getenv('DB_HOST', 'localhost')
    db_port = os.getenv('DB_PORT', '5432')

    if db_user and db_password and db_name:
        return normalize_database_url(f'postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}')

    return None


DB_URL = build_database_url()
DB_POOL_RECYCLE_SECONDS = int(os.getenv('DB_POOL_RECYCLE_SECONDS', '300'))

# Database utility functions
def get_engine():
    if not DB_URL:
        raise ValueError('Database configuration missing. Set DATABASE_URL or DB_USER/DB_PASSWORD/DB_HOST/DB_PORT/DB_NAME.')
    return create_engine(
        DB_URL,
        pool_pre_ping=True,
        pool_recycle=DB_POOL_RECYCLE_SECONDS,
    )

# Create a new SQLAlchemy session
def get_session():
    engine = get_engine()
    session_factory = sessionmaker(bind=engine)
    return session_factory()

# Check if a table exists in the database
def table_exists(session, table_name):
    query = text(
        """
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = :table_name
        )
        """
    )
    return bool(session.execute(query, {'table_name': table_name}).scalar())

# Read data from a specified table into a pandas DataFrame
def read_table(session, table_name, columns='*'):
    if not table_exists(session, table_name):
        return pd.DataFrame()

    query = text(f'SELECT {columns} FROM {table_name}')
    return pd.read_sql(query, session.bind)

#serialize metadata for logging, ensuring it's in a consistent format (dict or JSON string)
def serialize_metadata(metadata):
    if metadata is None:
        return {}
    if isinstance(metadata, dict):
        return metadata
    return {'value': metadata}

#Log ETL run details to the data_load_log table, including metadata and error information if applicable
def log_etl_run(
    session,
    filename,
    source_type,
    dataset_type,
    table_name,
    rows_read,
    rows_processed,
    rows_loaded,
    rows_flagged,
    status,
    error=None,
    metadata=None,
    started_at=None,
    completed_at=None,
):
    payload = {
        'filename': filename,
        'source_type': source_type,
        'dataset_type': dataset_type,
        'table_name': table_name,
        'rows_read': rows_read,
        'rows_processed': rows_processed,
        'rows_loaded': rows_loaded,
        'rows_flagged': rows_flagged,
        'status': status,
        'error_message': error,
        'started_at': started_at or datetime.utcnow(),
        'completed_at': completed_at or datetime.utcnow(),
        'run_metadata': json.dumps(serialize_metadata(metadata)),
    }

    try:
        sql = text(
            """
            INSERT INTO data_load_log (
                source_filename,
                source_type,
                dataset_type,
                table_name,
                rows_read,
                rows_processed,
                rows_loaded,
                rows_flagged,
                status,
                error_message,
                started_at,
                completed_at,
                run_metadata
            )
            VALUES (
                :filename,
                :source_type,
                :dataset_type,
                :table_name,
                :rows_read,
                :rows_processed,
                :rows_loaded,
                :rows_flagged,
                :status,
                :error_message,
                :started_at,
                :completed_at,
                CAST(:run_metadata AS jsonb)
            )
            """
        )
        session.execute(sql, payload)
        session.commit()
    except Exception as exc:
        print(f'Failed to log ETL run: {exc}')
        session.rollback()
