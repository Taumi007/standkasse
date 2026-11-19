"""Stände (mit Betreiber, Produktliste, Pfandliste und Zugangsschlüssel)."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
import secrets
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORE_KEY, STORE_VERSION

DEFAULT_DEPOSITS = "Tasse,3.00"


def to_cents(text: str | None) -> int | None:
    """'3.50', '3,50', '3,50 €' -> 350; leer/ungültig -> None."""
    if text is None:
        return None
    s = text.replace("€", "").replace(" ", "").replace(",", ".")
    if not s:
        return None
    try:
        return int((Decimal(s) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        return None


def parse_list(text: str, kind: str) -> tuple[list[dict[str, Any]], list[str]]:
    """CSV-Liste lesen. kind 'p': Name,Preis[,Pfand]  –  kind 'd': Name,Pfand.

    Komma- oder Semikolon-getrennt, Kopfzeile, Leerzeilen und #-Kommentare erlaubt.
    """
    items: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen: set[str] = set()
    first = True
    for no, raw in enumerate((text or "").splitlines(), 1):
        line = raw.strip().lstrip("﻿")
        if not line or line.startswith("#"):
            continue
        sep = ";" if ";" in line else ","
        cols = [c.strip().strip('"').strip() for c in line.split(sep)]
        name = cols[0][:60]
        nums = [to_cents(c) for c in cols[1:]]
        was_first, first = first, False
        if not name or not nums or nums[0] is None or nums[0] < 0:
            if not was_first:
                warnings.append(f"Zeile {no} ignoriert: „{line}“")
            continue
        if name.lower() in seen:
            warnings.append(f"Zeile {no}: „{name}“ doppelt, ignoriert")
            continue
        seen.add(name.lower())
        if sep == "," and len(cols) >= 3 and cols[1].isdigit() and len(cols[2]) == 2 and cols[2].isdigit():
            warnings.append(f"Zeile {no}: „{line}“ – {cols[1]},{cols[2]} € gemeint? Mit Komma-Trennung "
                            f"Dezimalpunkt verwenden ({cols[1]}.{cols[2]}) oder Semikolon ({name};{cols[1]},{cols[2]})")
        if kind == "p":
            pfand = nums[1] if len(nums) > 1 and nums[1] is not None else 0
            items.append({"name": name, "price": nums[0], "pfand": max(pfand, 0)})
        else:
            items.append({"name": name, "value": nums[0]})
    return items, warnings


def _clean(text: Any, limit: int) -> str:
    return str(text or "").strip()[:limit]


class StandStore:
    """Persistente Standliste (HA-Storage)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        self.stands: dict[str, dict[str, Any]] = {}

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.stands = {s["id"]: s for s in data.get("stands", [])}

    async def _save(self) -> None:
        await self._store.async_save({"stands": list(self.stands.values())})

    def get(self, stand_id: str | None) -> dict[str, Any] | None:
        return self.stands.get(stand_id or "")

    def authenticate(self, stand_id: Any, key: Any) -> dict[str, Any] | None:
        stand = self.get(str(stand_id or ""))
        if stand and isinstance(key, str) and secrets.compare_digest(stand["key"], key):
            return stand
        return None

    async def async_upsert(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = _clean(payload.get("name"), 40)
        if not name:
            raise ValueError("Name fehlt")
        stand_id = payload.get("id")
        stand = self.stands.get(stand_id) if stand_id else None
        if stand_id and not stand:
            raise ValueError("Stand nicht gefunden")
        if stand is None:
            stand = {"id": secrets.token_hex(4), "key": secrets.token_urlsafe(9),
                     "products": "", "deposits": DEFAULT_DEPOSITS, "active": True}
        stand["name"] = name
        stand["operator"] = _clean(payload.get("operator"), 40) or "Ohne Betreiber"
        if "products" in payload:
            stand["products"] = str(payload.get("products") or "")[:20000]
        if "deposits" in payload:
            stand["deposits"] = str(payload.get("deposits") or "")[:5000]
        if "active" in payload:
            stand["active"] = bool(payload["active"])
        self.stands[stand["id"]] = stand
        await self._save()
        return stand

    async def async_rotate_key(self, stand_id: str) -> dict[str, Any]:
        stand = self.stands[stand_id]
        stand["key"] = secrets.token_urlsafe(9)
        await self._save()
        return stand

    async def async_delete(self, stand_id: str) -> None:
        self.stands.pop(stand_id, None)
        await self._save()

    @staticmethod
    def client_config(stand: dict[str, Any]) -> dict[str, Any]:
        """Was die Kassenseite eines Standes braucht."""
        products, pw = parse_list(stand.get("products", ""), "p")
        deposits, dw = parse_list(stand.get("deposits", ""), "d")
        return {"id": stand["id"], "name": stand["name"], "operator": stand["operator"],
                "products": products, "deposits": deposits, "warnings": pw + dw}

    @staticmethod
    def admin_view(stand: dict[str, Any], with_key: bool) -> dict[str, Any]:
        out = dict(stand)
        _, pw = parse_list(stand.get("products", ""), "p")
        _, dw = parse_list(stand.get("deposits", ""), "d")
        out["warnings"] = pw + dw
        if not with_key:
            out.pop("key", None)
        return out
