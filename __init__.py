"""Standkasse: öffentliche Kassenseite für Marktstände plus Bon-Protokoll und Auswertung."""

from __future__ import annotations

import hashlib
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DB_FILE, DOMAIN, PANEL_ELEMENT, PANEL_URL, STATIC_URL
from .db import SalesDB
from .stands import StandStore
from .views import VIEWS

FRONTEND_DIR = Path(__file__).parent / "frontend"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})

    db = SalesDB(hass.config.path(DB_FILE))
    await hass.async_add_executor_job(db.open)
    stands = StandStore(hass)
    await stands.async_load()
    data["db"], data["stands"] = db, stands

    # Views lassen sich nicht abmelden – nur einmal pro HA-Lauf registrieren
    if not data.get("views"):
        for view in VIEWS:
            hass.http.register_view(view())
        data["views"] = True

    await _register_panel(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.get(DOMAIN, {})
    frontend.async_remove_panel(hass, PANEL_URL)
    db = data.pop("db", None)
    data.pop("stands", None)
    if db:
        await hass.async_add_executor_job(db.close)
    return True


async def _register_panel(hass: HomeAssistant) -> None:
    flags = hass.data[DOMAIN]
    if not flags.get("static"):
        def digest() -> str:
            h = hashlib.sha1()
            for p in sorted(FRONTEND_DIR.glob("*.js")):
                h.update(p.read_bytes())
            return h.hexdigest()[:10]

        flags["base"] = f"{STATIC_URL}/{await hass.async_add_executor_job(digest)}"
        await hass.http.async_register_static_paths([StaticPathConfig(flags["base"], str(FRONTEND_DIR), False)])
        flags["static"] = True
    if PANEL_URL in hass.data.get(frontend.DATA_PANELS, {}):
        return
    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL,
        module_url=f"{flags['base']}/standkasse-panel.js",
        sidebar_title="Standkasse",
        sidebar_icon="mdi:cash-register",
        require_admin=False,
        config={},
    )
