import logging
from sqlalchemy import text
from db_utils import get_session

logger = logging.getLogger(__name__)

class AnalyticsEngine:
    def __init__(self, engine):
        self.engine = engine

    def run_spatial_rollups(self):
        """
        Executes analytical rollups using PostGIS SQL across database tables.
        Calculates number of facilities per district and inserts them into analysis_results.
        """
        logger.info("Executing spatial rollups for District facilities...")
        session = get_session()
        
        try:
            # 1. Facility Count per District Rollup
            sql = """
            INSERT INTO analysis_results (
                analysis_type,
                admin_unit_id,
                admin_unit_code,
                admin_unit_name,
                admin_unit_type,
                metric_name,
                metric_value,
                metric_unit
            )
            SELECT 
                'resource_distribution' AS analysis_type,
                a.id AS admin_unit_id,
                a.code AS admin_unit_code,
                a.name AS admin_unit_name,
                a.type AS admin_unit_type,
                'total_health_facilities' AS metric_name,
                COUNT(h.id) AS metric_value,
                'count' AS metric_unit
            FROM administrative_units a
            LEFT JOIN health_facilities h 
                ON ST_Contains(a.geom, h.geom)
            WHERE a.type = 'District' OR a.type = 'Ward'
            GROUP BY a.id, a.code, a.name, a.type
            ON CONFLICT DO NOTHING;
            """
            
            session.execute(text(sql))
            session.commit()
            logger.info("Successfully executed health facility rollup analysis.")
            
        except Exception as e:
            logger.error(f"Error during analytics execution: {e}")
            session.rollback()
        finally:
            session.close()

