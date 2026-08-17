"""MongoDB access. MONGO_URI is read from the environment (.env via dotenv)."""
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

_client = None


def get_mongo_db():
    """Return the MongoDB database named in MONGO_URI, creating the client once.

    Lazy singleton shared by the API and the arq worker
    (ponytail: a rare double-init race just creates a second client).
    """
    global _client
    if _client is None:
        _client = MongoClient(os.environ["MONGO_URI"])
    return _client.get_default_database()
