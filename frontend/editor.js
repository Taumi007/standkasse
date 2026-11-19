// Tabellen-Editor für Produkte und Pfand-Rückgaben eines Standes – mit Prüfung beim Tippen
const FORBIDDEN = /[,;"\t]/;
const MONEY = /^\d{1,4}([.,]\d{1,2})?$/;

const nf = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (c) => nf.format((c || 0) / 100);
const eur = (c) => money(c) + " €";

export function h(tag, attrs = {}, ...children) {
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

/** "4" "4,5" "4.50" "4,50 €" -> 450 ; leer -> null ; ungültig -> NaN */
export function parseMoney(text) {
  const s = String(text ?? "").replace(/€/g, "").replace(/\s/g, "");
  if (!s) return null;
  if (!MONEY.test(s)) return NaN;
  return Math.round(Number(s.replace(",", ".")) * 100);
}

// CSV (Format der Integration) <-> Zeilen
function csvRows(text) {
  const rows = [], ignored = [];
  let first = true;
  (text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/^﻿/, "");
    if (!line || line.startsWith("#")) return;
    const sep = line.includes(";") ? ";" : ",";
    const cols = line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
    const wasFirst = first; first = false;
    const n = parseMoney(cols[1]);
    if (!cols[0] || n == null || Number.isNaN(n)) { if (!wasFirst) ignored.push(`Zeile ${i + 1}: „${line}“`); return; }
    rows.push(cols);
  });
  return { rows, ignored };
}
const fmt = (c) => (c / 100).toFixed(2);

export function fromStand(stand) {
  const p = csvRows(stand.products), d = csvRows(stand.deposits);
  return {
    products: p.rows.map((c) => ({ name: c[0], price: money(parseMoney(c[1])), pfand: parseMoney(c[2]) || 0 })),
    deposits: d.rows.map((c) => ({ name: c[0], value: money(parseMoney(c[1])) })),
    ignored: [...p.ignored, ...d.ignored],
  };
}

export function toCsv(draft) {
  return {
    products: draft.products.filter((r) => !isEmpty(r, "p"))
      .map((r) => `${r.name.trim()},${fmt(parseMoney(r.price))},${fmt(r.pfand || 0)}`).join("\n"),
    deposits: draft.deposits.filter((r) => !isEmpty(r, "d"))
      .map((r) => `${r.name.trim()},${fmt(parseMoney(r.value))}`).join("\n"),
  };
}

const isEmpty = (r, kind) => !r.name.trim() && !String(kind === "p" ? r.price : r.value).trim();

/** Prüft alle Zeilen. Ergebnis je Zeile: {errors: {feld: text}, warnings: [text]} */
export function validate(draft) {
  const out = { products: [], deposits: [], errorCount: 0, warningCount: 0 };
  const depValues = new Set();
  for (const kind of ["deposits", "products"]) {
    const seen = new Map();
    draft[kind].forEach((r, i) => {
      const res = { errors: {}, warnings: [] };
      out[kind].push(res);
      const k = kind === "products" ? "p" : "d";
      if (isEmpty(r, k)) return;
      const name = r.name.trim();
      if (!name) res.errors.name = "Name fehlt";
      else if (FORBIDDEN.test(name)) res.errors.name = "Keine Kommas, Strichpunkte oder Anführungszeichen";
      else if (name.length > 40) res.errors.name = "Höchstens 40 Zeichen";
      else {
        const key = name.toLocaleLowerCase("de").replace(/\s+/g, " ");
        if (seen.has(key)) res.errors.name = `Doppelt (Zeile ${seen.get(key) + 1})`;
        else seen.set(key, i);
      }
      const field = kind === "products" ? "price" : "value";
      const c = parseMoney(r[field]);
      if (c == null) res.errors[field] = kind === "products" ? "Preis fehlt" : "Betrag fehlt";
      else if (Number.isNaN(c)) res.errors[field] = "Ungültig – z. B. 4,50";
      else {
        if (kind === "deposits") {
          if (c === 0) res.errors[field] = "Betrag muss größer als 0 sein";
          depValues.add(c);
        } else {
          if (c === 0) res.warnings.push("Preis ist 0,00 €");
          if (c > 3000) res.warnings.push(`${eur(c)} – ungewöhnlich hoch, Tippfehler?`);
        }
        if (c % 10 !== 0) res.warnings.push(`${eur(c)} – kein glatter 10-Cent-Betrag, Tippfehler?`);
      }
      if (kind === "products" && r.pfand && !depValues.has(r.pfand))
        res.warnings.push(`Pfand ${eur(r.pfand)} hat keine passende Rückgabe-Kachel`);
    });
  }
  for (const kind of ["products", "deposits"])
    for (const r of out[kind]) {
      out.errorCount += Object.keys(r.errors).length;
      out.warningCount += r.warnings.length;
    }
  return out;
}

export const EDITOR_STYLE = `
.ed-section { margin-top: 18px; }
.ed-title { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.ed-title b { font-size: 15px; }
.ed-title .muted { font-size: 13px; }
table.ed { width: 100%; border-collapse: separate; border-spacing: 0; }
table.ed th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; padding: 4px 6px; border: 0; }
table.ed td { padding: 3px 4px; border: 0; vertical-align: middle; }
table.ed tr.row td { border-top: 1px solid var(--divider-color); padding-top: 6px; }
table.ed tr.msg td { padding: 0 6px 6px; font-size: 12.5px; }
table.ed input, table.ed select { width: 100%; height: 36px; font-size: 15px; }
table.ed input.money { text-align: right; font-variant-numeric: tabular-nums; }
table.ed input.bad, table.ed select.bad { border-color: var(--error-color, #db4437); box-shadow: 0 0 0 1px var(--error-color, #db4437); }
table.ed input.warnf { border-color: var(--warning-color, #ffa600); }
.ed .num { width: 28px; color: var(--sk-muted); font-size: 13px; text-align: right; }
.ed .tools { white-space: nowrap; width: 1%; }
.ed .tools button { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--divider-color);
  background: transparent; color: var(--primary-text-color); cursor: pointer; font-size: 15px; padding: 0; }
.ed .tools button:disabled { opacity: .3; cursor: default; }
.ed .tools button.del:hover { color: var(--error-color, #db4437); border-color: currentColor; }
.e-err { color: var(--error-color, #db4437); }
.e-warn { color: var(--warning-color, #ffa600); }
.add { margin-top: 8px; }
.summary { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; font-size: 14px; padding: 10px 12px; border-radius: 8px;
  background: var(--secondary-background-color, rgba(127,127,127,.08)); margin-top: 16px; }
.summary.bad { background: rgba(219, 68, 55, .14); }
.tablet { background: #121418; border-radius: 12px; padding: 12px; margin-top: 8px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.tile { position: relative; min-height: 76px; border-radius: 10px; background: #272b33; color: #f4f5f7; padding: 8px 10px;
  display: flex; flex-direction: column; justify-content: space-between; gap: 6px; font-family: -apple-system, system-ui, sans-serif; }
.tile .tn { font-size: 15px; font-weight: 700; line-height: 1.15; overflow-wrap: break-word; hyphens: auto; }
.tile .tm { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; }
.tile .tp { font-size: 16px; font-weight: 800; color: #ffb22e; white-space: nowrap; }
.tile .td { font-size: 11px; color: #c8cdd6; white-space: nowrap; }
.tile.ret { background: #15301f; box-shadow: inset 0 0 0 2px #34c77b; }
.tile.ret .tp { color: #34c77b; }
.tile.bad { box-shadow: inset 0 0 0 2px var(--error-color, #db4437); }
.textmode textarea { min-height: 220px; }
`;

/**
 * Baut den Editor. draft: {products:[{name,price,pfand}], deposits:[{name,value}]}
 * onChange(validation) wird nach jeder Änderung aufgerufen.
 */
export function productEditor(draft, onChange) {
  const root = h("div");
  const prodBox = h("div"), depBox = h("div"), previewBox = h("div");
  let focusAfter = null;   // {kind, index, field} – nach Neuaufbau wieder fokussieren
  let state = validate(draft);

  const notify = () => { state = validate(draft); onChange(state); };

  function depOptions(selected) {
    const opts = [h("option", { value: "0", selected: !selected }, "kein Pfand")];
    const used = new Set();
    draft.deposits.forEach((d) => {
      const c = parseMoney(d.value);
      if (!d.name.trim() || c == null || Number.isNaN(c) || c <= 0 || used.has(c)) return;
      used.add(c);
      opts.push(h("option", { value: String(c), selected: selected === c }, `${d.name.trim()} ${eur(c)}`));
    });
    if (selected && !used.has(selected)) opts.push(h("option", { value: String(selected), selected: true }, `${eur(selected)} (keine Rückgabe-Kachel)`));
    return opts;
  }

  function moneyInput(value, oninput) {
    const inp = h("input", { class: "money", value, inputMode: "decimal", placeholder: "0,00", autocomplete: "off" });
    inp.addEventListener("input", () => oninput(inp.value));
    inp.addEventListener("blur", () => {
      const c = parseMoney(inp.value);
      if (c != null && !Number.isNaN(c)) { inp.value = money(c); oninput(inp.value); }
    });
    return inp;
  }

  function table(kind) {
    const rows = draft[kind];
    const isP = kind === "products";
    const field = isP ? "price" : "value";
    const tbody = h("tbody");
    const cells = [];   // je Zeile die Eingabefelder und die Meldungszelle

    const rebuild = (focus) => { focusAfter = focus; render(); notify(); };
    const move = (i, d) => { const [r] = rows.splice(i, 1); rows.splice(i + d, 0, r); rebuild({ kind, index: i + d, field: "name" }); };
    const add = (at = rows.length) => {
      rows.splice(at, 0, isP ? { name: "", price: "", pfand: defaultPfand() } : { name: "", value: "" });
      rebuild({ kind, index: at, field: "name" });
    };

    rows.forEach((r, i) => {
      const name = h("input", { value: r.name, placeholder: isP ? "Produktname" : "z. B. Tasse", autocomplete: "off", autocapitalize: "sentences" });
      name.addEventListener("input", () => { r.name = name.value; update(); });
      const amount = moneyInput(r[field], (v) => { r[field] = v; update(); });
      const enter = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (i === rows.length - 1) add(); else cells[i + 1].name.focus();
      };
      name.addEventListener("keydown", enter);
      amount.addEventListener("keydown", enter);
      let pf = null;
      if (isP) {
        pf = h("select", {}, depOptions(r.pfand));
        pf.addEventListener("change", () => { r.pfand = Number(pf.value); update(); });
      }
      const msg = h("td", { colSpan: isP ? 5 : 4 });
      cells.push({ name, amount, pf, msg });
      tbody.append(
        h("tr", { class: "row" },
          h("td", { class: "num" }, i + 1),
          h("td", {}, name),
          h("td", { style: "width:110px" }, amount),
          isP ? h("td", { style: "width:200px" }, pf) : null,
          h("td", { class: "tools" },
            h("button", { title: "Nach oben", disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
            " ",
            h("button", { title: "Nach unten", disabled: i === rows.length - 1, onclick: () => move(i, +1) }, "↓"),
            " ",
            h("button", { class: "del", title: "Entfernen", onclick: () => { rows.splice(i, 1); rebuild(null); } }, "✕"))),
        h("tr", { class: "msg" }, h("td"), msg));
    });

    function update() {
      notify();
      const res = state[kind];
      cells.forEach((c, i) => {
        const v = res[i] || { errors: {}, warnings: [] };
        c.name.classList.toggle("bad", !!v.errors.name);
        c.amount.classList.toggle("bad", !!v.errors[field]);
        c.amount.classList.toggle("warnf", !v.errors[field] && v.warnings.some((w) => w.includes("€ –")));
        const texts = [...Object.values(v.errors).map((t) => h("span", { class: "e-err" }, "✕ " + t)),
          ...v.warnings.map((t) => h("span", { class: "e-warn" }, "⚠ " + t))];
        c.msg.replaceChildren(...texts.flatMap((t, j) => (j ? [" · ", t] : [t])));
        c.msg.parentElement.style.display = texts.length ? "" : "none";
      });
      if (!isP) {
        // Pfand-Auswahl der Produkte an geänderte Rückgaben anpassen
        prodBox.querySelectorAll("select").forEach((sel, j) => sel.replaceChildren(...depOptions(draft.products[j]?.pfand || 0)));
        table.updaters.products?.();
      }
      renderPreview();
    }
    table.updaters[kind] = update;

    return h("div", { class: "ed-section" },
      h("div", { class: "ed-title" },
        h("b", {}, isP ? "Produkte" : "Pfand-Rückgabe"),
        h("span", { class: "muted" }, isP
          ? "Reihenfolge = Reihenfolge der Kacheln am Tablet. Enter springt zur nächsten Zeile."
          : "Eine grüne Rückgabe-Kachel je Eintrag, meist nur »Tasse«.")),
      h("table", { class: "ed" },
        h("thead", {}, h("tr", {}, h("th"), h("th", {}, "Name"), h("th", { class: "r" }, isP ? "Preis €" : "Betrag €"),
          isP ? h("th", {}, "Pfand") : null, h("th"))),
        tbody),
      h("button", { class: "btn flat small add", onclick: () => add() }, isP ? "+ Produkt" : "+ Rückgabe"));
  }
  table.updaters = {};

  function defaultPfand() {
    // neues Produkt übernimmt das häufigste Pfand der bestehenden Produkte
    const counts = new Map();
    draft.products.forEach((p) => counts.set(p.pfand || 0, (counts.get(p.pfand || 0) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  }

  function renderPreview() {
    const tiles = [];
    draft.deposits.forEach((d, i) => {
      if (isEmpty(d, "d")) return;
      const c = parseMoney(d.value);
      const bad = Object.keys(state.deposits[i]?.errors || {}).length;
      tiles.push(h("div", { class: "tile ret" + (bad ? " bad" : "") }, h("div", { class: "tn" }, (d.name || "?") + " zurück"),
        h("div", { class: "tm" }, h("span", { class: "td" }, "Pfand"), h("span", { class: "tp" }, Number.isFinite(c) ? "−" + eur(c) : "?"))));
    });
    draft.products.forEach((p, i) => {
      if (isEmpty(p, "p")) return;
      const c = parseMoney(p.price);
      const bad = Object.keys(state.products[i]?.errors || {}).length;
      tiles.push(h("div", { class: "tile" + (bad ? " bad" : "") }, h("div", { class: "tn", lang: "de" }, p.name || "?"),
        h("div", { class: "tm" }, h("span", { class: "td" }, p.pfand ? `+ ${eur(p.pfand)} Pfand` : ""),
          h("span", { class: "tp" }, Number.isFinite(c) ? eur(c) : "?"))));
    });
    previewBox.replaceChildren(
      h("div", { class: "ed-title", style: "margin-top:18px" }, h("b", {}, "Vorschau am Tablet")),
      tiles.length ? h("div", { class: "tablet" }, tiles) : h("div", { class: "muted" }, "Noch keine Produkte."));
  }

  function render() {
    depBox.replaceChildren(table("deposits"));
    prodBox.replaceChildren(table("products"));
    table.updaters.deposits();
    table.updaters.products();
    if (focusAfter) {
      const box = focusAfter.kind === "products" ? prodBox : depBox;
      const inputs = box.querySelectorAll("tr.row");
      inputs[focusAfter.index]?.querySelector("input")?.focus();
      focusAfter = null;
    }
  }

  root.append(depBox, prodBox, previewBox);
  render();
  return root;
}
