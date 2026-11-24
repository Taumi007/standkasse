"""HTTP-Endpunkte.

Öffentlich (ohne HA-Login, abgesichert über Stand-ID + Schlüssel):
  GET  /kasse/                       Kassenseite
  GET  /api/standkasse/client        Konfiguration eines Standes
  POST /api/standkasse/sales         abgeschlossene Bons melden

Nur für angemeldete HA-Nutzer (Verwaltung zusätzlich nur Admins):
  GET  /api/standkasse/report        Auswertung
  GET/DELETE /api/standkasse/bons    Bon-Liste / Bons löschen (Admin)
  GET/POST/DELETE /api/standkasse/stands   Stände verwalten (Admin)
"""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
import time
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from .const import API_BASE, CLIENT_URL, DOMAIN, MAX_BODY, MAX_SALES_PER_POST
from .db import SalesDB, normalize_sale
from .stands import StandStore

CLIENT_FILE = Path(__file__).parent / "www" / "index.html"
NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}


def _data(hass: HomeAssistant) -> tuple[SalesDB, StandStore] | None:
    d = hass.data.get(DOMAIN, {})
    if d.get("db") and d.get("stands"):
        return d["db"], d["stands"]
    return None


def _unavailable() -> web.Response:
    return web.json_response({"error": "Standkasse nicht geladen"}, status=HTTPStatus.SERVICE_UNAVAILABLE,
                             headers=NO_CACHE)


def _require_admin(request: web.Request) -> None:
    if not request["hass_user"].is_admin:
        raise Unauthorized()


def _int_param(request: web.Request, name: str) -> int | None:
    value = request.query.get(name)
    if value in (None, ""):
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _json(data: Any, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, headers=NO_CACHE)


# ---------------------------------------------------------------- öffentlich
class ClientPageView(HomeAssistantView):
    url = CLIENT_URL + "/"
    extra_urls = [CLIENT_URL]
    name = "standkasse:client_page"
    requires_auth = False

    async def get(self, request: web.Request) -> web.StreamResponse:
        if request.path == CLIENT_URL:
            raise web.HTTPFound(CLIENT_URL + "/" + (("?" + request.query_string) if request.query_string else ""))
        hass = request.app[KEY_HASS]
        body = await hass.async_add_executor_job(CLIENT_FILE.read_bytes)
        return web.Response(body=body, content_type="text/html", charset="utf-8", headers=NO_CACHE)


class ClientConfigView(HomeAssistantView):
    url = API_BASE + "/client"
    name = "api:standkasse:client"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        stand = data[1].authenticate(request.query.get("s"), request.query.get("k"))
        if not stand:
            return _json({"error": "Unbekannter Stand oder ungültiger Link"}, HTTPStatus.FORBIDDEN)
        if not stand.get("active", True):
            return _json({"error": f"Stand »{stand['name']}« ist deaktiviert"}, HTTPStatus.FORBIDDEN)
        cfg = StandStore.client_config(stand)
        cfg["device_name"] = data[1].devices.get(request.query.get("d") or "", "")
        return _json(cfg)


class ClientDeviceView(HomeAssistantView):
    """Tablet benennt sich selbst (mit Stand-Schlüssel)."""

    url = API_BASE + "/device"
    name = "api:standkasse:device"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        try:
            body = await request.json()
        except ValueError:
            return _json({"error": "Kein JSON"}, HTTPStatus.BAD_REQUEST)
        if not isinstance(body, dict) or not data[1].authenticate(body.get("s"), body.get("k")):
            return _json({"error": "Unbekannter Stand oder ungültiger Link"}, HTTPStatus.FORBIDDEN)
        try:
            await data[1].async_set_device_name(body.get("d"), body.get("name") or "")
        except ValueError as err:
            return _json({"error": str(err)}, HTTPStatus.BAD_REQUEST)
        return _json({"ok": True})


class ClientSalesView(HomeAssistantView):
    url = API_BASE + "/sales"
    name = "api:standkasse:sales"
    requires_auth = False

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        db, stands = data
        if request.content_length and request.content_length > MAX_BODY:
            return _json({"error": "Zu groß"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = await request.json()
        except ValueError:
            return _json({"error": "Kein JSON"}, HTTPStatus.BAD_REQUEST)
        if not isinstance(body, dict):
            return _json({"error": "Kein JSON-Objekt"}, HTTPStatus.BAD_REQUEST)
        stand = stands.authenticate(body.get("s"), body.get("k"))
        if not stand:
            return _json({"error": "Unbekannter Stand oder ungültiger Link"}, HTTPStatus.FORBIDDEN)
        raw_sales = body.get("sales")
        if not isinstance(raw_sales, list) or len(raw_sales) > MAX_SALES_PER_POST:
            return _json({"error": "Bons ungültig"}, HTTPStatus.BAD_REQUEST)
        now = int(time.time() * 1000)
        valid, rejected = [], []
        for raw in raw_sales:
            try:
                valid.append(normalize_sale(raw, stand, now))
            except ValueError as err:
                rejected.append({"id": str(raw.get("id"))[:64] if isinstance(raw, dict) else None,
                                 "error": str(err)})
        if valid:
            await hass.async_add_executor_job(db.insert, valid)
        return _json({"accepted": [s["id"] for s in valid], "rejected": rejected})


# ---------------------------------------------------------------- HA-Nutzer
class ReportView(HomeAssistantView):
    url = API_BASE + "/report"
    name = "api:standkasse:report"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        result = await hass.async_add_executor_job(
            data[0].report, _int_param(request, "start"), _int_param(request, "end"))
        _apply_names(result["devices"], data[1])
        return _json(result)


class BonsView(HomeAssistantView):
    url = API_BASE + "/bons"
    name = "api:standkasse:bons"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        limit = min(max(_int_param(request, "limit") or 100, 1), 500)
        offset = max(_int_param(request, "offset") or 0, 0)
        result = await hass.async_add_executor_job(
            data[0].sales, _int_param(request, "start"), _int_param(request, "end"),
            request.query.get("stand") or None, limit, offset)
        _apply_names(result["sales"], data[1])
        return _json(result)

    async def delete(self, request: web.Request) -> web.Response:
        _require_admin(request)
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        body = await request.json()
        if isinstance(body.get("ids"), list):
            ids = [str(i) for i in body["ids"]][:1000]
            n = await hass.async_add_executor_job(data[0].delete, ids)
        elif body.get("all") is True:
            n = await hass.async_add_executor_job(
                data[0].delete_range, body.get("start"), body.get("end"), body.get("stand"))
        else:
            return _json({"error": "ids oder all fehlt"}, HTTPStatus.BAD_REQUEST)
        return _json({"deleted": n})


class StandsView(HomeAssistantView):
    url = API_BASE + "/stands"
    name = "api:standkasse:stands"

    async def get(self, request: web.Request) -> web.Response:
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        admin = request["hass_user"].is_admin
        return _json({"admin": admin,
                      "stands": [StandStore.admin_view(s, admin) for s in data[1].stands.values()]})

    async def post(self, request: web.Request) -> web.Response:
        _require_admin(request)
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        body = await request.json()
        stands = data[1]
        try:
            if body.get("rotate_key"):
                if body.get("id") not in stands.stands:
                    raise ValueError("Stand nicht gefunden")
                stand = await stands.async_rotate_key(body["id"])
            else:
                stand = await stands.async_upsert(body)
        except ValueError as err:
            return _json({"error": str(err)}, HTTPStatus.BAD_REQUEST)
        return _json(StandStore.admin_view(stand, True))

    async def delete(self, request: web.Request) -> web.Response:
        _require_admin(request)
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        body = await request.json()
        await data[1].async_delete(str(body.get("id")))
        return _json({"ok": True})


class DevicesView(HomeAssistantView):
    url = API_BASE + "/devices"
    name = "api:standkasse:devices"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        devices = await hass.async_add_executor_job(data[0].devices)
        known = {d["device_id"] for d in devices}
        # zentral benannte Geräte ohne Bons trotzdem zeigen
        devices += [{"device_id": i, "device_name": "", "bons": 0, "last": None, "stands": ""}
                    for i in data[1].devices if i not in known]
        _apply_names(devices, data[1])
        return _json({"devices": devices})

    async def post(self, request: web.Request) -> web.Response:
        _require_admin(request)
        data = _data(request.app[KEY_HASS])
        if not data:
            return _unavailable()
        body = await request.json()
        try:
            await data[1].async_set_device_name(body.get("id"), body.get("name") or "")
        except ValueError as err:
            return _json({"error": str(err)}, HTTPStatus.BAD_REQUEST)
        return _json({"ok": True})


class ResetView(HomeAssistantView):
    """Alle Bons löschen, optional auch Stände und Gerätenamen."""

    url = API_BASE + "/reset"
    name = "api:standkasse:reset"

    async def post(self, request: web.Request) -> web.Response:
        _require_admin(request)
        hass = request.app[KEY_HASS]
        data = _data(hass)
        if not data:
            return _unavailable()
        body = await request.json()
        n = await hass.async_add_executor_job(data[0].reset)
        if body.get("stands") is True:
            await data[1].async_reset()
        return _json({"deleted": n, "stands_reset": body.get("stands") is True})


def _apply_names(rows: list[dict[str, Any]], stands: StandStore) -> None:
    """Zentral vergebene Gerätenamen haben Vorrang vor dem Namen im Bon."""
    for r in rows:
        name = stands.devices.get(r.get("device_id") or "")
        if name:
            r["device_name"] = name


VIEWS = (ClientPageView, ClientConfigView, ClientDeviceView, ClientSalesView, ReportView, BonsView,
         StandsView, DevicesView, ResetView)
