// Standkasse-Panel: Auswertung pro Betreiber, Bon-Liste, Standverwaltung
import { EDITOR_STYLE, fromStand, productEditor, toCsv, validate } from "./editor.js";
const DAY_START_HOUR = 6;           // ein Markttag läuft von 06:00 bis 06:00
const DAY = 24 * 3600 * 1000;

const nf = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (c) => ((c || 0) < 0 ? "−" : "") + nf.format(Math.abs(c || 0) / 100) + " €";
const dt = (ms) => new Date(ms).toLocaleString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const tm = (ms) => new Date(ms).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

// Gleiche Regeln wie stands.parse_list – für die Vorschau im Formular
function toCents(s) {
  s = String(s ?? "").replace(/€/g, "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function parseList(text, kind) {
  const items = [], warnings = [], seen = new Set();
  let first = true;
  (text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/^﻿/, "");
    if (!line || line.startsWith("#")) return;
    const sep = line.includes(";") ? ";" : ",";
    const cols = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    const name = cols[0].slice(0, 60), nums = cols.slice(1).map(toCents);
    const wasFirst = first; first = false;
    if (!name || !nums.length || nums[0] == null || nums[0] < 0) { if (!wasFirst) warnings.push(`Zeile ${i + 1} ignoriert: „${line}“`); return; }
    if (seen.has(name.toLowerCase())) { warnings.push(`Zeile ${i + 1}: „${name}“ doppelt, ignoriert`); return; }
    seen.add(name.toLowerCase());
    if (sep === "," && cols.length >= 3 && /^\d+$/.test(cols[1]) && /^\d\d$/.test(cols[2]))
      warnings.push(`Zeile ${i + 1}: „${line}“ – ${cols[1]},${cols[2]} € gemeint? Mit Komma-Trennung Dezimalpunkt verwenden (${cols[1]}.${cols[2]}) oder Semikolon (${name};${cols[1]},${cols[2]})`);
    items.push(kind === "p" ? { name, price: nums[0], pfand: Math.max(nums[1] ?? 0, 0) } : { name, value: nums[0] });
  });
  return { items, warnings };
}

function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() > ts) d.setDate(d.getDate() - 1);
  return d.getTime();
}
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

const STYLE = `
:host { --sk-muted: color-mix(in srgb, var(--secondary-text-color) 30%, var(--primary-text-color)); display: block; height: 100%; background: var(--primary-background-color); color: var(--primary-text-color);
  font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
.toolbar { display: flex; align-items: center; gap: 8px; height: var(--header-height, 56px); padding: 0 12px;
  background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff);
  border-bottom: var(--app-header-border-bottom, none); box-sizing: border-box; }
.toolbar .title { font-size: 20px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tabs { display: flex; gap: 4px; }
.tabs button { background: transparent; border: 0; color: inherit; opacity: .75; font: inherit; font-size: 15px; padding: 8px 12px; border-radius: 18px; cursor: pointer; }
.tabs button.on { opacity: 1; background: rgba(255,255,255,.18); font-weight: 600; }
main { padding: 16px; max-width: 1200px; margin: 0 auto; box-sizing: border-box; height: calc(100% - var(--header-height, 56px)); overflow-y: auto; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
.chip { border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
  border-radius: 18px; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
.chip.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
input, select, textarea { font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--card-background-color);
  border: 1px solid var(--divider-color); border-radius: 8px; padding: 7px 9px; box-sizing: border-box; }
textarea { width: 100%; font-family: ui-monospace, Menlo, monospace; min-height: 160px; }
.spacer { flex: 1; }
.btn { border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--primary-color); color: var(--text-primary-color, #fff); }
.btn.flat { background: transparent; color: var(--primary-color); border: 1px solid var(--divider-color); }
.btn.danger { background: var(--error-color, #db4437); color: #fff; }
.btn.small { padding: 5px 10px; font-size: 13px; }
.card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
  box-shadow: var(--ha-card-box-shadow, none); border: 1px solid var(--divider-color); padding: 16px; margin-bottom: 16px; }
.op-title { font-size: 22px; font-weight: 600; margin: 4px 0 12px; display: flex; align-items: baseline; gap: 10px; }
.op-title .sub { font-size: 14px; font-weight: 400; color: var(--sk-muted); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.kpi { border: 1px solid var(--divider-color); border-radius: 10px; padding: 10px 12px; }
.kpi .l { font-size: 13px; color: var(--sk-muted); }
.kpi .v { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
.kpi .s { font-size: 12px; color: var(--sk-muted); margin-top: 2px; }
.kpi.main .v { color: var(--primary-color); }
details { border-top: 1px solid var(--divider-color); padding: 8px 0; }
summary { cursor: pointer; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; padding: 4px 0; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: "▸"; color: var(--sk-muted); }
details[open] > summary::before { content: "▾"; }
summary .name { font-weight: 600; font-size: 17px; }
summary .meta { color: var(--sk-muted); font-size: 14px; }
.cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; margin-top: 8px; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-weight: 500; color: var(--sk-muted); border-bottom: 1px solid var(--divider-color); padding: 6px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--divider-color); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.muted { color: var(--sk-muted); }
.ret { color: var(--success-color, #43a047); }
tr.sum td { font-weight: 600; border-top: 2px solid var(--divider-color); }
.empty { text-align: center; color: var(--sk-muted); padding: 40px 10px; }
.err { background: var(--error-color, #db4437); color: #fff; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; }
.warn { color: var(--warning-color, #ffa600); font-size: 13px; }
.hours { display: flex; align-items: flex-end; gap: 3px; height: 60px; margin: 6px 0 2px; }
.hours div { flex: 1; background: var(--primary-color); opacity: .7; border-radius: 3px 3px 0 0; min-height: 2px; }
.hours-l { display: flex; justify-content: space-between; font-size: 11px; color: var(--sk-muted); }
.stand-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stand-head .name { font-size: 18px; font-weight: 600; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--divider-color); }
.badge.off { background: var(--error-color, #db4437); color: #fff; }
.link { display: flex; gap: 6px; margin-top: 10px; }
.link input { flex: 1; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
.form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--sk-muted); }
.form .full { grid-column: 1 / -1; }
@media (max-width: 700px) { .form { grid-template-columns: 1fr; } }
.items { font-size: 13px; color: var(--sk-muted); }
.preview { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pv { font-size: 13px; border: 1px solid var(--divider-color); border-radius: 6px; padding: 3px 8px; }
.pv.ret { color: var(--success-color, #43a047); border-color: currentColor; }
`;

class StandkassePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.tab = "report";
    this.preset = "today";
    this.custom = { start: dayStart(Date.now()), end: dayStart(Date.now()) + DAY };
    this.stands = [];
    this.admin = false;
    this.report = null;
    this.bons = { list: [], count: 0, stand: "" };
    this.editing = null;
    this.error = "";
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this.menuBtn) this.menuBtn.hass = hass;
    if (first) this.init();
  }
  set narrow(n) { this._narrow = n; if (this.menuBtn) this.menuBtn.narrow = n; }
  set panel(_) {}

  async init() {
    this.menuBtn = document.createElement("ha-menu-button");
    this.menuBtn.hass = this._hass;
    this.menuBtn.narrow = this._narrow;
    this.tabsEl = h("div", { class: "tabs" });
    this.main = h("main");
    this.shadowRoot.append(
      h("style", {}, STYLE + EDITOR_STYLE),
      h("div", { class: "toolbar" }, this.menuBtn, h("div", { class: "title" }, "Standkasse"), this.tabsEl),
      this.main,
    );
    this.timer = setInterval(() => {
      if (document.visibilityState === "visible" && this.tab === "report" && this.isConnected) this.loadReport(true);
    }, 30000);
    await this.loadStands();
    this.show(this.tab);
  }

  disconnectedCallback() { /* Timer läuft weiter, prüft isConnected */ }

  api(method, path, data) { return this._hass.callApi(method, "standkasse/" + path, data); }

  async loadStands() {
    try {
      const r = await this.api("GET", "stands");
      this.stands = r.stands;
      this.admin = r.admin;
    } catch (e) { this.error = "Stände konnten nicht geladen werden: " + (e.body?.error || e.message || e.error || e); }
  }

  range() {
    const today = dayStart(Date.now());
    switch (this.preset) {
      case "today": return { start: today, end: today + DAY };
      case "yesterday": return { start: today - DAY, end: today };
      case "week": return { start: today - 6 * DAY, end: today + DAY };
      case "all": return { start: null, end: null };
      default: return this.custom;
    }
  }
  qs(extra = {}) {
    const { start, end } = this.range();
    const p = new URLSearchParams();
    if (start != null) p.set("start", start);
    if (end != null) p.set("end", end);
    for (const [k, v] of Object.entries(extra)) if (v !== "" && v != null) p.set(k, v);
    return p.toString();
  }

  show(tab) {
    this.tab = tab;
    this.tabsEl.replaceChildren(...[["report", "Auswertung"], ["bons", "Bons"], ["stands", "Stände"]]
      .map(([k, l]) => h("button", { class: k === tab ? "on" : "", onclick: () => this.show(k) }, l)));
    if (tab === "report") this.loadReport();
    else if (tab === "bons") this.loadBons(true);
    else this.renderStands();
  }

  rangeBar(onchange) {
    const presets = [["today", "Heute"], ["yesterday", "Gestern"], ["week", "7 Tage"], ["all", "Alles"], ["custom", "Zeitraum"]];
    const bar = h("div", { class: "bar" }, presets.map(([k, l]) =>
      h("button", { class: "chip" + (this.preset === k ? " on" : ""), onclick: () => { this.preset = k; onchange(); } }, l)));
    if (this.preset === "custom") {
      const from = h("input", { type: "datetime-local", value: toLocalInput(this.custom.start) });
      const to = h("input", { type: "datetime-local", value: toLocalInput(this.custom.end) });
      const apply = () => {
        const s = new Date(from.value).getTime(), e = new Date(to.value).getTime();
        if (s && e && e > s) { this.custom = { start: s, end: e }; onchange(); }
      };
      from.addEventListener("change", apply); to.addEventListener("change", apply);
      bar.append(from, "–", to);
    } else if (this.preset !== "all") {
      const { start, end } = this.range();
      bar.append(h("span", { class: "muted" }, `${dt(start)} – ${dt(end)}`));
    }
    return bar;
  }

  errorBox() { return this.error ? h("div", { class: "err" }, this.error) : null; }

  // ------------------------------------------------------------ Auswertung
  async loadReport(silent) {
    if (!silent) this.main.replaceChildren(this.rangeBar(() => this.loadReport()), h("div", { class: "empty" }, "Lade …"));
    try {
      this.report = await this.api("GET", "report?" + this.qs());
      this.error = "";
    } catch (e) { this.error = "Auswertung fehlgeschlagen: " + (e.body?.error || e.message || e.error || e); }
    if (this.tab === "report") this.renderReport();
  }

  operators() {
    // Betreiber -> Stände; aus den Bons (Stand zum Verkaufszeitpunkt) ergänzt um konfigurierte Stände
    const r = this.report || { stands: [] };
    const ops = new Map();
    for (const s of r.stands) {
      if (!ops.has(s.operator)) ops.set(s.operator, []);
      ops.get(s.operator).push(s);
    }
    return [...ops.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"));
  }

  renderReport() {
    const r = this.report;
    const top = h("div", { class: "bar" });
    const rb = this.rangeBar(() => this.loadReport());
    rb.append(h("span", { class: "spacer" }),
      h("button", { class: "btn flat", onclick: () => this.exportCsv() }, "CSV-Export"),
      h("button", { class: "btn flat", onclick: () => this.loadReport() }, "Aktualisieren"));
    const parts = [rb, this.errorBox()];
    if (r && !r.stands.length) parts.push(h("div", { class: "card empty" }, "Keine Bons in diesem Zeitraum."));
    for (const [op, stands] of this.operators()) parts.push(this.operatorCard(op, stands));
    if (r) parts.push(h("div", { class: "muted", style: "font-size:12px" }, `Stand: ${tm(r.generated)} · aktualisiert alle 30 s`));
    this.main.replaceChildren(...parts.filter(Boolean));
  }

  operatorCard(op, stands) {
    const r = this.report;
    const sum = (k) => stands.reduce((a, s) => a + (s[k] || 0), 0);
    const out = sum("cups_out"), back = sum("cups_back");
    stands.sort((a, b) => a.stand_name.localeCompare(b.stand_name, "de"));
    return h("div", { class: "card" },
      h("div", { class: "op-title" }, op, h("span", { class: "sub" }, `${stands.length} Stand${stands.length === 1 ? "" : "e"} · getrennte Abrechnung`)),
      h("div", { class: "kpis" },
        this.kpi("Kassa gesamt", eur(sum("total")), "sollte in der Kasse sein", true),
        this.kpi("Waren", eur(sum("goods"))),
        this.kpi("Pfand netto", eur(sum("pfand")), `${out} raus · ${back} zurück`),
        this.kpi("Tassen draußen", String(out - back), "ausgegeben − zurück"),
        this.kpi("Bons", String(sum("bons")))),
      stands.map((s) => this.standDetails(s, r)));
  }

  kpi(label, value, sub, main) {
    return h("div", { class: "kpi" + (main ? " main" : "") }, h("div", { class: "l" }, label), h("div", { class: "v" }, value),
      sub ? h("div", { class: "s" }, sub) : null);
  }

  standDetails(s, r) {
    const prods = r.products.filter((p) => p.stand_id === s.stand_id);
    const devices = r.devices.filter((d) => d.stand_id === s.stand_id);
    const hours = r.hours.filter((x) => x.stand_id === s.stand_id);
    const goods = prods.filter((p) => p.kind === "p");
    const rets = prods.filter((p) => p.kind === "r");
    const price = (p) => p.price_min === p.price_max ? eur(p.price_min) : `${eur(p.price_min)}–${eur(p.price_max)}`;

    const prodTable = h("table", {},
      h("tr", {}, h("th", {}, "Produkt"), h("th", { class: "r" }, "Stück"), h("th", { class: "r" }, "Preis"), h("th", { class: "r" }, "Umsatz")),
      goods.map((p) => h("tr", {}, h("td", {}, p.name), h("td", { class: "r" }, p.qty), h("td", { class: "r muted" }, price(p)), h("td", { class: "r" }, eur(p.goods)))),
      rets.map((p) => h("tr", {}, h("td", { class: "ret" }, p.name + " zurück"), h("td", { class: "r" }, p.qty), h("td", {}), h("td", { class: "r ret" }, eur(p.pfand)))),
      h("tr", { class: "sum" }, h("td", {}, "Summe Waren"), h("td", { class: "r" }, goods.reduce((a, p) => a + p.qty, 0)), h("td", {}), h("td", { class: "r" }, eur(s.goods))),
    );

    const devTable = h("table", {},
      h("tr", {}, h("th", {}, "Gerät"), h("th", { class: "r" }, "Bons"), h("th", { class: "r" }, "Summe"), h("th", { class: "r" }, "Letzter Bon")),
      devices.map((d) => h("tr", {},
        h("td", {}, d.device_name || h("span", { class: "muted" }, "ohne Namen · " + (d.device_id || "?").slice(0, 6))),
        h("td", { class: "r" }, d.bons), h("td", { class: "r" }, eur(d.total)), h("td", { class: "r muted" }, dt(d.last)))));

    let hourChart = null;
    if (hours.length > 1) {
      const first = hours[0].hour, last = hours[hours.length - 1].hour;
      const buckets = [];
      for (let t = first; t <= last; t += 3600000) buckets.push(hours.find((x) => x.hour === t)?.total || 0);
      const max = Math.max(...buckets, 1);
      hourChart = h("div", {},
        h("div", { class: "muted", style: "font-size:13px;margin-top:14px" }, "Umsatz pro Stunde"),
        h("div", { class: "hours" }, buckets.map((v, i) => h("div", { style: `height:${Math.max(3, (v / max) * 100)}%`, title: `${tm(first + i * 3600000)}: ${eur(v)}` }))),
        h("div", { class: "hours-l" }, h("span", {}, tm(first)), h("span", {}, tm(last))));
    }

    return h("details", { open: true },
      h("summary", {}, h("span", { class: "name" }, s.stand_name),
        h("span", { class: "meta" }, `${s.bons} Bons · Kassa ${eur(s.total)} · Waren ${eur(s.goods)} · Pfand ${eur(s.pfand)} · Tassen ${s.cups_out} raus / ${s.cups_back} zurück · ${tm(s.first)}–${tm(s.last)}`)),
      h("div", { class: "cols" }, h("div", {}, prodTable), h("div", {}, devTable, hourChart)));
  }

  exportCsv() {
    const r = this.report;
    if (!r) return;
    const num = (c) => ((c || 0) / 100).toFixed(2).replace(".", ",");
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const names = Object.fromEntries(r.stands.map((s) => [s.stand_id, s]));
    const rows = [["Betreiber", "Stand", "Art", "Produkt", "Stück", "Umsatz Waren", "Pfand"].join(";")];
    for (const p of r.products) {
      const s = names[p.stand_id] || {};
      rows.push([q(s.operator), q(s.stand_name), p.kind === "r" ? "Rückgabe" : "Produkt", q(p.name), p.qty, num(p.goods), num(p.pfand)].join(";"));
    }
    const { start, end } = this.range();
    const label = start ? new Date(start).toISOString().slice(0, 10) + (end - start > DAY ? "_bis_" + new Date(end - 1).toISOString().slice(0, 10) : "") : "alles";
    const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `standkasse_${label}.csv` });
    this.shadowRoot.append(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------ Bons
  async loadBons(reset) {
    if (reset) this.bons.list = [];
    try {
      const r = await this.api("GET", "bons?" + this.qs({ stand: this.bons.stand, limit: 100, offset: this.bons.list.length }));
      this.bons.list = this.bons.list.concat(r.sales);
      this.bons.count = r.count;
      this.error = "";
    } catch (e) { this.error = "Bons konnten nicht geladen werden: " + (e.body?.error || e.message || e.error || e); }
    if (this.tab === "bons") this.renderBons();
  }

  renderBons() {
    const bar = this.rangeBar(() => this.loadBons(true));
    const sel = h("select", { onchange: (e) => { this.bons.stand = e.target.value; this.loadBons(true); } },
      h("option", { value: "" }, "Alle Stände"),
      [...this.stands].sort((a, b) => (a.operator + a.name).localeCompare(b.operator + b.name, "de"))
        .map((s) => h("option", { value: s.id, selected: s.id === this.bons.stand }, `${s.operator} · ${s.name}`)));
    bar.append(sel, h("span", { class: "spacer" }), h("span", { class: "muted" }, `${this.bons.count} Bons`));
    if (this.admin && this.bons.count) {
      bar.append(h("button", { class: "btn danger small", onclick: () => this.deleteRange() }, "Alle im Zeitraum löschen"));
    }
    const table = h("table", {},
      h("tr", {}, h("th", {}, "Zeit"), h("th", {}, "Stand"), h("th", {}, "Gerät"), h("th", {}, "Positionen"),
        h("th", { class: "r" }, "Summe"), h("th", { class: "r" }, "Gegeben"), this.admin ? h("th", {}) : null),
      this.bons.list.map((b) => h("tr", {},
        h("td", { class: "muted", style: "white-space:nowrap" }, dt(b.ts)),
        h("td", {}, b.stand_name, h("div", { class: "items" }, b.operator)),
        h("td", { class: "muted" }, b.device_name || (b.device_id || "").slice(0, 6)),
        h("td", { class: "items" }, b.items.map((i) => i.kind === "r" ? `${i.qty}× ${i.name} zurück` : `${i.qty}× ${i.name}`).join(", ")),
        h("td", { class: "r" + (b.total < 0 ? " ret" : "") }, eur(b.total)),
        h("td", { class: "r muted" }, b.given != null ? eur(b.given) : ""),
        this.admin ? h("td", { class: "r" }, h("button", { class: "btn flat small", title: "Bon löschen", onclick: () => this.deleteBon(b) }, "✕")) : null)));
    const more = this.bons.list.length < this.bons.count
      ? h("div", { style: "text-align:center;margin-top:12px" }, h("button", { class: "btn flat", onclick: () => this.loadBons(false) }, "Weitere laden")) : null;
    this.main.replaceChildren(...[bar, this.errorBox(),
      this.bons.list.length ? h("div", { class: "card" }, table, more) : h("div", { class: "card empty" }, "Keine Bons in diesem Zeitraum.")].filter(Boolean));
  }

  async deleteBon(b) {
    if (!confirm(`Bon von ${dt(b.ts)} (${b.stand_name}, ${eur(b.total)}) löschen?`)) return;
    await this.api("DELETE", "bons", { ids: [b.id] });
    this.loadBons(true);
  }

  async deleteRange() {
    const { start, end } = this.range();
    const stand = this.stands.find((s) => s.id === this.bons.stand);
    const what = `${this.bons.count} Bons${stand ? ` von »${stand.name}«` : " aller Stände"}${start ? ` zwischen ${dt(start)} und ${dt(end)}` : " (gesamter Zeitraum)"}`;
    if (prompt(`${what} endgültig löschen?\nZum Bestätigen LÖSCHEN eintippen:`) !== "LÖSCHEN") return;
    await this.api("DELETE", "bons", { all: true, start, end, stand: this.bons.stand || null });
    this.loadBons(true);
  }

  // ------------------------------------------------------------ Stände
  link(s) { return `${location.origin}/kasse/?s=${encodeURIComponent(s.id)}&k=${encodeURIComponent(s.key)}`; }

  renderStands() {
    const parts = [this.errorBox()];
    if (!this.admin) parts.push(h("div", { class: "card muted" }, "Stände verwalten können nur Administratoren."));
    const bar = h("div", { class: "bar" },
      h("span", { class: "muted" }, "Jeder Stand hat einen eigenen Link. Den Link auf dem Tablet öffnen und am besten zum Home-Bildschirm hinzufügen."),
      h("span", { class: "spacer" }),
      this.admin ? h("button", { class: "btn", onclick: () => { this.editing = "new"; this.renderStands(); } }, "Neuer Stand") : null);
    parts.push(bar);
    if (this.editing === "new") parts.push(this.standForm({ name: "", operator: "", products: "", deposits: "Tasse,3.00", active: true }));

    const sorted = [...this.stands].sort((a, b) => (a.operator + a.name).localeCompare(b.operator + b.name, "de"));
    if (!sorted.length && this.editing !== "new") parts.push(h("div", { class: "card empty" }, "Noch keine Stände angelegt."));
    for (const s of sorted) parts.push(this.editing === s.id ? this.standForm(s) : this.standCard(s));
    this.main.replaceChildren(...parts.filter(Boolean));
  }

  preview(products, deposits) {
    const p = parseList(products, "p"), d = parseList(deposits, "d");
    return {
      warnings: [...p.warnings, ...d.warnings],
      el: h("div", { class: "preview" },
        d.items.map((x) => h("span", { class: "pv ret" }, `${x.name} zurück −${eur(x.value)}`)),
        p.items.map((x) => h("span", { class: "pv" }, h("b", {}, x.name), " ", eur(x.price), x.pfand ? h("span", { class: "muted" }, ` + ${eur(x.pfand)} Pfand`) : null))),
      count: p.items.length,
    };
  }

  standCard(s) {
    const pv = this.preview(s.products, s.deposits);
    const count = pv.count;
    const linkInput = this.admin ? h("input", { readOnly: true, value: this.link(s), onfocus: (e) => e.target.select() }) : null;
    return h("div", { class: "card" },
      h("div", { class: "stand-head" },
        h("span", { class: "name" }, s.name), h("span", { class: "badge" }, s.operator),
        s.active ? null : h("span", { class: "badge off" }, "deaktiviert"),
        h("span", { class: "muted" }, `${count} Produkte`),
        h("span", { class: "spacer" }),
        this.admin ? h("button", { class: "btn flat small", onclick: () => { this.editing = s.id; this.renderStands(); } }, "Bearbeiten") : null),
      pv.warnings.map((w) => h("div", { class: "warn" }, "⚠ " + w)),
      pv.el,
      this.admin ? h("div", { class: "link" }, linkInput,
        h("button", { class: "btn flat small", onclick: (e) => this.copy(linkInput, e.target) }, "Kopieren"),
        h("button", { class: "btn flat small", onclick: () => window.open(this.link(s), "_blank") }, "Öffnen")) : null);
  }

  async copy(input, btn) {
    try { await navigator.clipboard.writeText(input.value); }
    catch (e) { input.focus(); input.select(); document.execCommand("copy"); }
    const old = btn.textContent; btn.textContent = "Kopiert ✓"; setTimeout(() => (btn.textContent = old), 1500);
  }

  standForm(s) {
    const operators = [...new Set(this.stands.map((x) => x.operator))].sort();
    const dl = h("datalist", { id: "ops" }, operators.map((o) => h("option", { value: o })));
    const name = h("input", { value: s.name, placeholder: "z. B. Glühweinstand" });
    const operator = h("input", { value: s.operator, placeholder: "z. B. Musikverein" });
    operator.setAttribute("list", "ops");
    const active = h("input", { type: "checkbox", checked: s.active !== false });

    let draft = fromStand(s);
    let state = validate(draft);
    let mode = "table";
    const editorBox = h("div", { class: "full" });
    const summary = h("div", { class: "summary full" });
    const msg = h("div", { class: "full" });
    const saveBtn = h("button", { class: "btn" }, "Speichern");
    const modeBtn = h("button", { class: "btn flat small" });

    const refresh = (st) => {
      state = st;
      const n = draft.products.filter((p) => p.name.trim()).length;
      summary.className = "summary full" + (st.errorCount ? " bad" : "");
      summary.replaceChildren(...[
        h("span", {}, `${n} Produkt${n === 1 ? "" : "e"}`),
        st.errorCount ? h("span", { class: "e-err" }, `✕ ${st.errorCount} Fehler – Speichern erst nach Korrektur möglich`) : h("span", {}, "✓ keine Fehler"),
        st.warningCount ? h("span", { class: "e-warn" }, `⚠ ${st.warningCount} Hinweis${st.warningCount === 1 ? "" : "e"} – bitte prüfen`) : null,
      ].filter(Boolean));
      saveBtn.disabled = mode === "table" && st.errorCount > 0;
    };

    const ignoredBanner = (lines) => lines.length
      ? h("div", { class: "err", style: "background:var(--warning-color,#ffa600)" },
        "Diese Zeilen konnten nicht übernommen werden und fehlen in der Tabelle: ", lines.join(" · ")) : null;

    const showTable = (ignored = draft.ignored || []) => {
      mode = "table";
      modeBtn.textContent = "Als Text bearbeiten";
      editorBox.replaceChildren(...[ignoredBanner(ignored), productEditor(draft, refresh)].filter(Boolean));
      summary.style.display = "";
      refresh(validate(draft));
    };
    let taP, taD;
    const showText = () => {
      if (state.errorCount) { msg.replaceChildren(h("div", { class: "err" }, "Bitte zuerst die markierten Fehler beheben.")); return; }
      msg.replaceChildren();
      mode = "text";
      modeBtn.textContent = "Zurück zur Tabelle";
      const csv = toCsv(draft);
      taP = h("textarea", { value: csv.products });
      taD = h("textarea", { value: csv.deposits, style: "min-height:60px" });
      editorBox.replaceChildren(h("div", { class: "textmode" },
        h("div", { class: "muted", style: "font-size:13px;margin:12px 0 4px" }, "Zum Einfügen aus Excel o. Ä.: eine Zeile pro Produkt – Name,Preis,Pfand (Punkt als Dezimalzeichen) oder Name;Preis;Pfand (Komma als Dezimalzeichen). Danach »Zurück zur Tabelle« zum Prüfen."),
        h("label", {}, "Produkte", taP), h("label", { style: "display:block;margin-top:8px" }, "Pfand-Rückgabe", taD)));
      summary.style.display = "none";
      saveBtn.disabled = false;
    };
    const textToDraft = () => { draft = fromStand({ products: taP.value, deposits: taD.value }); };
    modeBtn.addEventListener("click", () => {
      if (mode === "table") showText();
      else { textToDraft(); showTable(); }
    });

    saveBtn.addEventListener("click", async () => {
      if (mode === "text") { textToDraft(); showTable(); return; }   // erst prüfen lassen
      if (!name.value.trim()) { msg.replaceChildren(h("div", { class: "err" }, "Bitte einen Namen für den Stand eingeben.")); name.focus(); return; }
      if (state.errorCount) return;
      if (state.warningCount && !confirm(`Es gibt ${state.warningCount} Hinweis(e) (gelb markiert). Trotzdem speichern?`)) return;
      const csv = toCsv(draft);
      try {
        await this.api("POST", "stands", {
          id: s.id, name: name.value, operator: operator.value, products: csv.products,
          deposits: csv.deposits, active: active.checked,
        });
        await this.loadStands();
        this.editing = null;
        this.renderStands();
      } catch (e) { msg.replaceChildren(h("div", { class: "err" }, e.body?.error || e.message || e.error || String(e))); }
    });

    showTable();
    const actions = h("div", { class: "bar full", style: "margin:0" },
      saveBtn,
      h("button", { class: "btn flat", onclick: () => { this.editing = null; this.renderStands(); } }, "Abbrechen"),
      modeBtn,
      h("span", { class: "spacer" }),
      s.id ? h("button", { class: "btn flat", onclick: () => this.rotate(s) }, "Neuen Link erzeugen") : null,
      s.id ? h("button", { class: "btn danger", onclick: () => this.remove(s) }, "Stand löschen") : null);
    return h("div", { class: "card" }, dl,
      h("div", { class: "stand-head" }, h("span", { class: "name" }, s.id ? `»${s.name}« bearbeiten` : "Neuer Stand")),
      h("div", { class: "form" },
        h("label", {}, "Name des Standes", name),
        h("label", {}, "Betreiber (wird getrennt abgerechnet)", operator),
        h("label", { class: "full", style: "flex-direction:row;align-items:center;gap:8px" }, active, "Stand aktiv (Link funktioniert)"),
        editorBox, summary, msg, actions));
  }

  async rotate(s) {
    if (!confirm(`Neuen Link für »${s.name}« erzeugen?\nDer bisherige Link funktioniert danach nicht mehr – alle Tablets dieses Standes brauchen den neuen Link.`)) return;
    await this.api("POST", "stands", { id: s.id, rotate_key: true });
    await this.loadStands();
    this.editing = null;
    this.renderStands();
  }

  async remove(s) {
    if (!confirm(`Stand »${s.name}« löschen?\nDie bereits protokollierten Bons bleiben erhalten.`)) return;
    await this.api("DELETE", "stands", { id: s.id });
    await this.loadStands();
    this.editing = null;
    this.renderStands();
  }
}

customElements.define("standkasse-panel", StandkassePanel);
