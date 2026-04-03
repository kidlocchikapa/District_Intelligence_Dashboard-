import os
from dotenv import load_dotenv

# Load environment variables from .env file (if it exists)
load_dotenv()

# Database configuration
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "district_dashboard_db")

# Construct SQLAlchemy database URI
DATABASE_URI = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Data Directories
RAW_DATA_DIR = os.getenv("RAW_DATA_DIR", "/app/sample_data")

# Generic Column Mappings (Source Column -> Target DB Column)
# Adjust these mappings based on actual files
MAPPINGS = {
    "health_facilities": {
        "Facility Name": "name",
        "name": "name",
        "Facility_Type": "type",
        "type": "type",
        "amenity": "amenity",
        "healthcare": "healthcare",
        "capacity": "capacity:persons",
        "beds": "beds_count",
        "lat": "latitude",
        "lon": "longitude",
        "latitude": "latitude",
        "longitude": "longitude",
    },
    "education_facilities": {
        "School Name": "name",
        "name": "name",
        "School_Type": "amenity",
        "amenity": "amenity",
        "capacity": "capacity:persons",
        "enrollment": "student_enrollment_total",
        "teachers": "teacher_count",
        "lat": "latitude",
        "lon": "longitude",
        "latitude": "latitude",
        "longitude": "longitude",
    },
    "administrative_units": {
        "Name": "name",
        "name": "name",
        "Type": "type",
        "type": "type",
        "Code": "code",
        "code": "code",
        "Population": "population_total",
    }
}
