"""Konstanten der Standkasse."""

DOMAIN = "standkasse"
DB_FILE = "standkasse.db"
STORE_KEY = "standkasse.stands"
STORE_VERSION = 1

CLIENT_URL = "/kasse"              # öffentliche Kassenseite (ohne Login)
API_BASE = "/api/standkasse"
STATIC_URL = "/standkasse_static"  # Panel-Dateien
PANEL_URL = "standkasse"
PANEL_ELEMENT = "standkasse-panel"

MAX_BODY = 512 * 1024
MAX_SALES_PER_POST = 100
MAX_ITEMS_PER_SALE = 200
