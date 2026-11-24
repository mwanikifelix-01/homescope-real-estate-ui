// Homescope js part: talks directly to our api and not RapidAPI so key is never visible to the browser

"use strict";

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
    "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", 
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", 
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", 
    "WI", "WY"];

const PAGE_SIZE = 24;
const SAVED_KEY = "homescope.markets";

const $ = (selector) => document.querySelector(selector);
let market = null;
let shown = PAGE_SIZE;
let zipSort = { key: "sold_count", dir: -1 };


function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === "text") node.textContent = value;
        else if (key === "class") node.className = value;
        else node.setAttribute(key, value);
    }
    children.forEach((child) => node.append(child));
    return node;
}

const money = (n) => (n == null ? "_" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n) => (n == null ? "_" : Number(n).toLocaleString("en-US"));
const typeName = (t) => String(t).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const homePrice = (h) => h.sold_price || h.price;

function showMessage(text, kind = "") {
    const box = $("#message");
    box.textContent = text;
    box.className = "message " + kind;
    box.hidden = !text;
}

async function getJSON(url) {
    let response;
    try {
        response = await fetch(url);
    } catch (err) {
        throw new Error("Cannot reach the server. Check your internet connection");
    }
    const server = response.headers.get("X-Served-By");
    if (server) $("#served-by").textContent = "Served by: " + server;
    let data = null;
    try{
        data = await response.json();
    } catch (err) {}
    if (!response.ok || !data) {
        throw new Error((data && data.error) || "Something went wrong. Please Try Again");
    }
    return data;
}

async function search(event) {
    event.preventDefault();
    const city = $("#city").value.trim();
    const state = $("#state").value;
    if (!city || !state) return;

    $("#search-btn").disabled = true
    $("#results").hidden = true;
    showMessage("Loading homes in " + city + ", " + state + "...");
    try {
        market = await getJSON("/api/market?city=" + encodeURIComponent(city) + "&state=" + encodeURIComponent(state));
        if (market.warnings.length) showMessage(market.warnings[0], "warn");
        else showMessage("");
        saveMarket();
        renderAll();
    } catch (err) {
        showMessage(err.message, "error");
    } finally {
        $("#search-btn").disabled = false;
    }
}


function renderAll() {
    const s = market.summary;
    $("#market-title").textContent = market.city + ", " + market.state;
    $("#tiles").replaceChildren(
        tile("Median asking price", money(s.median_list)),
        tile("Median sold price", money(s.median_sold)),
        tile("Median $ per sqft", money(s.median_ppsf)),
        tile("Median days to sell", num(s.median_days)),
        tile("Homes for sale", num(s.for_sale_total)));

    const types = new Set(market.for_sale.concat(market.sold).map((h) => h.type));
    $("#f-type").replaceChildren(el("option", { value: "", text: "All types"}),
      ...[...types].sort().map((t) => el("option", { value: t, text: typeName(t) })));

    shown = PAGE_SIZE;
    renderHomes();
    renderBest();
    renderZips();
    renderCompare();
    $("#results").hidden = false;
}

function tile(label, value) {
    return el("div", { class: "tile" }, [
        el("div", { class: "label", text: label}),
        el("div", { class: "value", text: value})]);
}

function filteredHomes() {
    const text = $("#f-text").value.trim().toLowerCase();
    const type = $("#f-type").value;
    const beds = Number($("#f-beds").value);
    const maxPrice = Number($("#f-price").value) || Infinity;
    const [field, direction] = $("#f-sort").value.split("-");
    const value = (h) => (field === "price" ? homePrice(h) : h[field]);

    return market[$("#f-view").value]
     .filter((h) => !text || (h.address + " " + (h.zip || "")).toLowerCase().includes(text))
     .filter((h) => !type || h.type === type)
     .filter((h) => (h.beds || 0) >= beds)
     .filter((h) => homePrice(h) <= maxPrice)
     .sort((a, b) => {
        const x = value(a), y = value(b);
        if (x == null) return 1;
        if (y == null) return -1;
        return direction == "asc" ? x - y : y - x;
     });
}

function renderHomes() {
    const homes = filteredHomes();
    const sold = $("#f-view").value === "sold";
    $("#count").textContent = homes.length + (sold ? " recently sold" : " for sale") +
      (homes.length === 1 ? " home matches" : " homes match") + " your filters.";
    $("#cards").replaceChildren(...homes.slice(0, shown).map(card));
    $("#more").hidden = homes.length <= shown;
}

function card(home) {
    let picture;
    if (home.photo) {
        picture = el("img", { src: home.photo, alt: "", loading: "lazy"});
    } else {
        picture = el("div", { class: "no-photo", text: "No photo"});
    }

    const facts = [
        home.beds != null ? home.beds + " bd" : null,
        home.baths != null ? home.baths + " ba" : null,
        home.sqft ? num(home.sqft) + " sqft" : null,
        home.ppsf ? money(home.ppsf) + "/sqft" : null,
    ].filter(Boolean).join(" . ");
    const badge = home.sold_date ? "Sold " + home.sold_date
       : (home.days != null ? home.days + " days on market" : typeName(home.type));

    const button = el("button", {class: "card", type: "button" }, [
        picture,
        el("div", {class: "body"}, [
            el("div", { class: "price", text: money(homePrice(home)) }),
            el("div", { class: "facts", text: facts || "Details not listed"}),
            el("div", { class: "addr", text: home.address + ", " + (home.city || "") + " " + (home.zip || "") }),
            el("span", { class: "badge", text: badge})])]);
    button.addEventListener("click", () => openDetail(home));
    return button;
}

function renderBest() {
    const byType = market.by_type;
    const byBeds = market.by_beds;
    const total = market.summary.sold_sample;
    const insight = $("#best-insight");
    if (!total) {
        insight.textContent = "No recent sales data is available for this city"
    } else {
        const share = (row) => Math.round((row.count / total) * 100) + "%";
        let text = "Out of " + total + " recent sales, ";
        text += typeName(byType[0].name).toLowerCase() + " homes sold the most (" + share(byType[0]) + ")";
        if (byBeds.length) text += ", and " + byBeds[0].name + "-bedroom homes were the most common size (" + share(byBeds[0]) + ")";
        insight.textContent = text + ".";
    }
    $("#bars-type").replaceChildren(...bars(byType, (r) => typeName(r.name)));
    $("#bars-beds").replaceChildren(...bars(
        [...byBeds].sort((a, b) => a.name - b.name), (r) => r.name + " bedrooms"));
}

function bars(rows, label) {
    if(!rows.length) return [el("p", {class: "muted", text: "No data." })];
    const max = Math.max(...rows.map((r) => r.count));
    return rows.map((row) => {
        const fill = el("div", { class: "bar-fill" });
        fill.style.width = (row.count / max) * 100 + "%";
        let detail = row.count + " sold . median " + money(row.median_price);
        if (row.median_days != null) detail += " . " + row.median_days + " days";
        return el("div", { class: "bar-row" }, [
            el("div", { class: "bar-head"}, [
                el("strong", { text: label(row) }),
                el("span", { class: "muted", text: detail })]),
            el("div", { class: "bar-track" }, [fill])]); 
    });
}

function renderZips() {
    const rows = [...market.by_zip].sort((a, b) => {
        const x = a[zipSort.key], y = b[zipSort.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * zipSort.dir;
    });
     $("#zip-table tbody").replaceChildren(...rows.map((r) => el("tr", {}, [
    el("td", { text: r.zip }),
    el("td", { text: num(r.sold_count) }),
    el("td", { text: num(r.active_count) }),
    el("td", { text: money(r.median_sold) }),
    el("td", { text: money(r.median_list) }),
    el("td", { text: money(r.median_ppsf) })])));
  document.querySelectorAll("#zip-table th").forEach((th) => {
    th.className = th.dataset.key === zipSort.key
      ? "sorted" + (zipSort.dir === 1 ? " asc" : "") : "";
  });

    const withSales = market.by_zip.filter((r) => r.sold_count >= 3 && r.median_ppsf);
    const insight = $("#invest-insight");
    if (!withSales.length) {
        insight.textContent = "There are not enough recent sales to compare ZIP codes in this city.";
        return;
    }
    const busiest = withSales.reduce((a, b) => (b.sold_count > a.sold_count ? b : a));
    const cheapest = withSales.reduce((a, b) => (b.median_ppsf < a.median_ppsf ? b : a));
    insight.textContent = "Most recent sales: ZIP " + busiest.zip + " (" + busiest.sold_count +
        " sold). Lowest price per sqft among active areas: ZIP " + cheapest.zip + " (" +
        money(cheapest.median_ppsf) + "/sqft). Many sales with few homes left for sale suggests strong demand.";

}

function loadSaved() {
    try{
        return JSON.parse(localStorage.getItem(SAVED_KEY)) || [];
    } catch (err) {
        return [];
    }
}

function storeSaved(list) {
    try{
        localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (err) {}
}

function saveMarket() {
    const name = market.city + ", " + market.state;
    const others = loadSaved().filter((m) => m.name !== name);
    storeSaved([{ name: name, summary: market.summary }].concat(others));
}

function renderCompare() {
    const saved = loadSaved();
    $("#compare-table tbody").replaceChildren(...saved.map((m) => {
        const remove = el("button", { text: "Remove", "aria-label": "Remove " + m.name});
        remove.addEventListener("click", () => {
            storeSaved(loadSaved().filter((x) => x.name !== m.name));
            renderCompare();
        });
        return el("tr", {}, [
            el("td", { text: m.name }),
            el("td", { text: money(m.summary.median_list) }),
            el("td", { text: money(m.summary.median_sold) }),
            el("td", { text: money(m.summary.median_ppsf) }),
            el("td", { text: num(m.summary.median_days) }),
            el("td", { text: num(m.summary.for_sale_total) }),
            el("td", {}, [remove])]);
    }));
}

async function openDetail(home) {
    const body = $("#detail-body");
    const heading = [
        el("h2", { text: money(homePrice(home)) + (home.sold_date ? " (sold)" : "") }),
        el("p", { text: home.address + ", " + (home.city || "") + ", " + (home.state || "") + " " +(home.zip || "") })];
    body.replaceChildren(...heading, el("p", { class: "muted", text: "Loading details..."}));
    $("#detail").showModal();

    const parts = [...heading];
    try{
        const d = await getJSON("/api/property/" + encodeURIComponent(home.id));
        if (d.photos.length) {
            parts.push(el("div", { class: "photos" },
                d.photos.map((src) => el("img", { src: src, alt: "Photo of the home", loading: "lazy"}))));
        }
        const facts = [
            ["Beds", home.beds], ["Baths", home.baths], ["Size (sqft)", num(home.sqft)],
            ["$ / sqft", money(home.ppsf)], ["Type", typeName(home.type)],
            ["Year built", d.year_built], ["Lot (sqft)", d.lot_sqft && num(d.lot_sqft)],
            ["Garage spaces", d.garage], ["Stories", d.stories],
        ].filter((f) => f[1] !=null && f[1] !== "_");
        parts.push(el("div", { class: "kv" }, facts.map((f) => 
           el("div", {}, [document.createTextNode(f[0]), el("b", { text: String(f[1]) })]))));
        if (d.text) parts.push(el("p", { text: d.text}));
        if (d.history.length) {
            parts.push(el("h3", { text: "Price History"}));
            parts.push(el("div", { class: "table-scroll" }, [el("table", {}, [
                el("tbody", {}, d.history.map((h) => el("tr", {}, [
                    el("td", { text: h.date }), el("td", { text: h.event}), el("td", { text: money(h.price)})])))])]));
        }
    } catch (err) {
        parts.push(el("p", { class: "message error", text: err.message }));
    }
    body.replaceChildren(...parts);
}

$("#state").replaceChildren(el("option", { value: "", text: "Select" }),
  ...STATES.map((s) => el("option", { value: s, text: s })));
$("#search-form").addEventListener("submit", search);

["#f-view", "#f-type", "#f-beds", "#f-sort"].forEach((id) => 
    $(id).addEventListener("change", () => { shown = PAGE_SIZE; renderHomes(); }));
["#f-text", "#f-price"].forEach((id) => 
    $(id).addEventListener("input", () => { shown = PAGE_SIZE; renderHomes(); }));
$("#more").addEventListener("click", () => { shown += PAGE_SIZE; renderHomes(); });

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    ["homes", "best", "invest"].forEach((name) => {
        $("#tab-" + name).hidden = name !== tab.dataset.tab;
    });
}));

document.querySelectorAll("#zip-table th").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.key;
    zipSort = { key: key, dir: zipSort.key === key ? -zipSort.dir : (key === "zip" ? 1 : -1) };
    renderZips();
}));

$("#detail-close").addEventListener("click", () => $("#detail").close());