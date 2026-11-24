"""Bon-Protokoll in einer eigenen SQLite-Datei (getrennt von der HA-Datenbank).

Alle Methoden sind blockierend und laufen im Executor.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from typing import Any

from .const import MAX_ITEMS_PER_SALE

SCHEMA = """
CREATE TABLE IF NOT EXISTS sales(
  id TEXT PRIMARY KEY,
  stand_id TEXT NOT NULL,
  stand_name TEXT NOT NULL,
  operator TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  received INTEGER NOT NULL,
  goods INTEGER NOT NULL,
  pfand INTEGER NOT NULL,
  total INTEGER NOT NULL,
  given INTEGER,
  cups_out INTEGER NOT NULL,
  cups_back INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_ts ON sales(ts);
CREATE TABLE IF NOT EXISTS sale_items(
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  pfand INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_sale ON sale_items(sale_id);
"""

ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
WEEK_MS = 7 * 24 * 3600 * 1000


def _int(value: Any, lo: int, hi: int, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError(f"{what} ungültig")
    return value


def normalize_sale(raw: Any, stand: dict[str, Any], now_ms: int) -> dict[str, Any]:
    """Bon vom Client prüfen und Summen serverseitig neu berechnen."""
    if not isinstance(raw, dict):
        raise ValueError("Bon ungültig")
    sale_id = raw.get("id")
    if not isinstance(sale_id, str) or not ID_RE.match(sale_id):
        raise ValueError("Bon-ID ungültig")
    items_raw = raw.get("items")
    if not isinstance(items_raw, list) or not 0 < len(items_raw) <= MAX_ITEMS_PER_SALE:
        raise ValueError("Positionen ungültig")
    items = []
    goods = pfand = cups_out = cups_back = 0
    for it in items_raw:
        if not isinstance(it, dict) or it.get("kind") not in ("p", "r"):
            raise ValueError("Position ungültig")
        name = str(it.get("name") or "").strip()[:60]
        if not name:
            raise ValueError("Positionsname fehlt")
        qty = _int(it.get("qty"), 1, 1000, "Menge")
        if it["kind"] == "p":
            price = _int(it.get("price"), 0, 100000, "Preis")
            dep = _int(it.get("pfand"), 0, 100000, "Pfand")
            if dep:
                cups_out += qty
        else:
            price = 0
            dep = -abs(_int(it.get("pfand"), -100000, 100000, "Pfand"))
            cups_back += qty
        goods += price * qty
        pfand += dep * qty
        items.append({"kind": it["kind"], "name": name, "qty": qty, "price": price, "pfand": dep})
    given = raw.get("given")
    given = None if given is None else _int(given, 0, 10_000_000, "Gegeben")
    ts = raw.get("ts")
    if isinstance(ts, bool) or not isinstance(ts, int) or abs(ts - now_ms) > WEEK_MS:
        ts = now_ms  # Uhr des Tablets unplausibel
    return {
        "id": sale_id,
        "stand_id": stand["id"],
        "stand_name": stand["name"],
        "operator": stand["operator"],
        "device_id": str(raw.get("device") or "")[:64],
        "device_name": str(raw.get("device_name") or "").strip()[:40],
        "ts": ts,
        "received": now_ms,
        "goods": goods,
        "pfand": pfand,
        "total": goods + pfand,
        "given": given,
        "cups_out": cups_out,
        "cups_back": cups_back,
        "items": items,
    }


class SalesDB:
    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.executescript(SCHEMA)
        conn.commit()
        self._conn = conn

    def close(self) -> None:
        with self._lock:
            if self._conn:
                self._conn.close()
                self._conn = None

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("Datenbank geschlossen")
        return self._conn

    # ---------- Schreiben ----------
    def insert(self, sales: list[dict[str, Any]]) -> None:
        with self._lock, self.conn as c:
            for s in sales:
                cur = c.execute(
                    "INSERT OR IGNORE INTO sales(id,stand_id,stand_name,operator,device_id,device_name,ts,received,"
                    "goods,pfand,total,given,cups_out,cups_back) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (s["id"], s["stand_id"], s["stand_name"], s["operator"], s["device_id"], s["device_name"],
                     s["ts"], s["received"], s["goods"], s["pfand"], s["total"], s["given"],
                     s["cups_out"], s["cups_back"]))
                if cur.rowcount:
                    c.executemany(
                        "INSERT INTO sale_items(sale_id,kind,name,qty,price,pfand) VALUES(?,?,?,?,?,?)",
                        [(s["id"], i["kind"], i["name"], i["qty"], i["price"], i["pfand"]) for i in s["items"]])

    def delete(self, ids: list[str]) -> int:
        with self._lock, self.conn as c:
            n = 0
            for sale_id in ids:
                n += c.execute("DELETE FROM sales WHERE id=?", (sale_id,)).rowcount
            return n

    def reset(self) -> int:
        with self._lock, self.conn as c:
            n = c.execute("DELETE FROM sales").rowcount
            c.execute("DELETE FROM sale_items")
        with self._lock:
            self.conn.execute("VACUUM")
        return n

    def devices(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self.conn.execute(
                "SELECT device_id, MAX(device_name) AS device_name, COUNT(*) AS bons, MAX(ts) AS last,"
                " GROUP_CONCAT(DISTINCT stand_name) AS stands FROM sales GROUP BY device_id ORDER BY last DESC")]

    def delete_range(self, start: int, end: int, stand_id: str | None) -> int:
        where, args = self._where(start, end, stand_id)
        with self._lock, self.conn as c:
            return c.execute(f"DELETE FROM sales AS s {where}", args).rowcount

    # ---------- Lesen ----------
    @staticmethod
    def _where(start: int | None, end: int | None, stand_id: str | None = None) -> tuple[str, list[Any]]:
        cond, args = [], []
        if start is not None:
            cond.append("s.ts >= ?")
            args.append(start)
        if end is not None:
            cond.append("s.ts < ?")
            args.append(end)
        if stand_id:
            cond.append("s.stand_id = ?")
            args.append(stand_id)
        return ("WHERE " + " AND ".join(cond)) if cond else "", args

    def report(self, start: int | None, end: int | None) -> dict[str, Any]:
        where, args = self._where(start, end)
        with self._lock:
            c = self.conn
            stands = [dict(r) for r in c.execute(
                "SELECT s.stand_id, MAX(s.stand_name) AS stand_name, MAX(s.operator) AS operator, COUNT(*) AS bons,"
                " SUM(s.goods) AS goods, SUM(s.pfand) AS pfand, SUM(s.total) AS total,"
                " SUM(s.cups_out) AS cups_out, SUM(s.cups_back) AS cups_back, MIN(s.ts) AS first, MAX(s.ts) AS last"
                f" FROM sales s {where} GROUP BY s.stand_id", args)]
            products = [dict(r) for r in c.execute(
                "SELECT s.stand_id, i.kind, i.name, SUM(i.qty) AS qty, SUM(i.qty*i.price) AS goods,"
                " SUM(i.qty*i.pfand) AS pfand, MIN(i.price) AS price_min, MAX(i.price) AS price_max"
                f" FROM sale_items i JOIN sales s ON s.id = i.sale_id {where}"
                " GROUP BY s.stand_id, i.kind, i.name ORDER BY i.kind, qty DESC", args)]
            devices = [dict(r) for r in c.execute(
                "SELECT s.stand_id, s.device_id, MAX(s.device_name) AS device_name, COUNT(*) AS bons,"
                " SUM(s.total) AS total, MAX(s.ts) AS last, MAX(s.received) AS last_received"
                f" FROM sales s {where} GROUP BY s.stand_id, s.device_id ORDER BY last DESC", args)]
            hours = [dict(r) for r in c.execute(
                "SELECT s.stand_id, (s.ts / 3600000) * 3600000 AS hour, COUNT(*) AS bons, SUM(s.total) AS total"
                f" FROM sales s {where} GROUP BY s.stand_id, hour ORDER BY hour", args)]
        return {"stands": stands, "products": products, "devices": devices, "hours": hours,
                "generated": int(time.time() * 1000)}

    def sales(self, start: int | None, end: int | None, stand_id: str | None,
              limit: int, offset: int) -> dict[str, Any]:
        where, args = self._where(start, end, stand_id)
        with self._lock:
            c = self.conn
            total = c.execute(f"SELECT COUNT(*) FROM sales s {where}", args).fetchone()[0]
            rows = [dict(r) for r in c.execute(
                f"SELECT s.* FROM sales s {where} ORDER BY s.ts DESC LIMIT ? OFFSET ?", [*args, limit, offset])]
            ids = [r["id"] for r in rows]
            items: dict[str, list[dict[str, Any]]] = {i: [] for i in ids}
            for chunk in (ids[i:i + 500] for i in range(0, len(ids), 500)):
                q = ",".join("?" * len(chunk))
                for r in c.execute(f"SELECT * FROM sale_items WHERE sale_id IN ({q}) ORDER BY rowid", chunk):
                    d = dict(r)
                    items[d.pop("sale_id")].append(d)
        for r in rows:
            r["items"] = items[r["id"]]
        return {"count": total, "sales": rows}
