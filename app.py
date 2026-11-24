"""Homescope - simple web app for knowing real estate houses in US"""


import json
import os
import re
import socket
import time
from datetime import date
from statistics import median

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

API_KEY = os.getenv("RAPIDAPI_KEY", "")
API_HOST =os.getenv("RAPID_HOST", "realty-in-us.p.rapidapi.com")
CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))       
RESULT_LIMIT = int(os.getenv("RESULT_LIMIT", "200"))   
TIMEOUT = 20                                           


ENDPOINTS = {
    "list": "/properties/v3/list",       
    "detail": "/properties/v3/detail",   
}

SEARCHES = {
    "for_sale": {"status": ["for_sale"],
                 "sort": {"direction": "desc", "field": "list_date"}},
    "sold": {"status": ["sold"],
             "sort": {"direction": "desc", "field": "sold_date"}},
}

STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
}
CITY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z .'\-]{1,49}$")
HOSTNAME = socket.gethostname()

app = Flask(__name__, static_folder="static", static_url_path="")
_cache = {}  

class ApiError(Exception):
    """A problem talking to the external API, with a user-friendly message."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


def call_api(path, params=None, body=None):
    """Call one API endpoint and return the decoded JSON.

    If body is given it is sent as JSON with POST, otherwise GET is used.
    Successful responses are cached in memory for CACHE_TTL seconds so that
    repeated searches are fast and do not use up the API quota.
    """
    if not API_KEY:
        raise ApiError("The server has no API key. Add RAPIDAPI_KEY to the "
                       ".env file and restart.", 500)

    key = path + json.dumps([params, body], sort_keys=True)
    cached = _cache.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    headers = {"x-rapidapi-key": API_KEY, "x-rapidapi-host": API_HOST}
    try:
        response = requests.request(
            "POST" if body else "GET", "https://" + API_HOST + path,
            params=params, json=body, headers=headers, timeout=TIMEOUT)
    except requests.Timeout:
        raise ApiError("The real estate API took too long to answer. "
                       "Please try again.", 504)
    except requests.RequestException:
        raise ApiError("Could not reach the real estate API. "
                       "Please try again later.")

    if response.status_code == 429:
        raise ApiError("The API request limit has been reached. "
                       "Please try again later.", 429)
    if response.status_code in (401, 403):
        raise ApiError("The API key was rejected. Check the key and that "
                       "you are subscribed to the API on RapidAPI.", 502)
    if response.status_code != 200:
        raise ApiError("The real estate API returned an error ({:d}).".format(
            response.status_code))
    try:
        data = response.json()
    except ValueError:
        raise ApiError("The real estate API sent an unreadable response.")

    if len(_cache) >= 200:  
        del _cache[min(_cache, key=lambda k: _cache[k][0])]
    _cache[key] = (time.time() + CACHE_TTL, data)
    return data


def find_results(payload):
    """Find the list of homes inside an API response.

    Returns (homes, total). The list is searched for instead of read from a
    fixed path, so small changes in the API's response do not break the app.
    """
    queue = [payload]
    while queue:
        node = queue.pop(0)
        if isinstance(node, dict):
            results = node.get("results")
            if isinstance(results, list):
                return ([r for r in results if isinstance(r, dict)],
                        node.get("total"))
            queue.extend(node.values())
        elif isinstance(node, list):
            queue.extend(node)
    return [], None


def find_home(payload):
    """Find the single home object inside a property-detail response."""
    queue = [payload]
    while queue:
        node = queue.pop(0)
        if isinstance(node, dict):
            if isinstance(node.get("description"), dict):
                return node
            queue.extend(node.values())
    return None


def to_number(value):
    """Return value as a number, or None if it is missing or invalid."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def to_date(value):
    """Parse the first 10 characters of an ISO date string, or None."""
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def normalize(item):
    """Convert one raw API listing into the small dict the frontend uses."""
    desc = item.get("description") or {}
    address = (item.get("location") or {}).get("address") or {}
    photo = (item.get("primary_photo") or {}).get("href")
    link = item.get("permalink") or item.get("href")
    if link and not str(link).startswith("http"):
        link = "https://www.realtor.com/realestateandhomes-detail/" + link

    price = to_number(item.get("list_price"))
    sold_price = to_number(desc.get("sold_price")
                           or item.get("last_sold_price"))
    sold_date = desc.get("sold_date") or item.get("last_sold_date")
    sqft = to_number(desc.get("sqft"))
    value = sold_price or price

    days = None 
    listed = to_date(item.get("list_date")) 
    if listed:
        end = to_date(sold_date) if sold_date else date.today()
        if end and 0 <= (end - listed).days <= 730:
            days = (end - listed).days

    return {
        "id": str(item.get("property_id") or ""),
        "address": address.get("line") or "Address not available",
        "city": address.get("city"),
        "state": address.get("state_code"),
        "zip": address.get("postal_code"),
        "price": price,
        "sold_price": sold_price,
        "sold_date": str(sold_date)[:10] if sold_date else None,
        "beds": to_number(desc.get("beds")),
        "baths": to_number(desc.get("baths")),
        "sqft": sqft,
        "type": desc.get("type") or "other",
        "ppsf": round(value / sqft) if value and sqft else None,
        "days": days,
        "photo": photo,
        "link": link,
    }


def mid(values):
    """Median of the non-empty values, or None if there are none."""
    values = [v for v in values if v is not None]
    return round(median(values)) if values else None


def group_sold(sold, key):
    """Group sold homes by a field and summarise each group."""
    groups = {}
    for home in sold:
        if home[key] is not None:
            groups.setdefault(home[key], []).append(home)
    rows = []
    for name, homes in groups.items():
        rows.append({
            "name": name,
            "count": len(homes),
            "median_price": mid(h["sold_price"] for h in homes),
            "median_ppsf": mid(h["ppsf"] for h in homes),
            "median_days": mid(h["days"] for h in homes),
        })
    return sorted(rows, key=lambda r: r["count"], reverse=True)


def group_zip(for_sale, sold):
    """Compare ZIP codes: recent sales, homes on the market and prices."""
    zips = {}
    for home in for_sale:
        if home["zip"]:
            zips.setdefault(home["zip"], ([], []))[0].append(home)
    for home in sold:
        if home["zip"]:
            zips.setdefault(home["zip"], ([], []))[1].append(home)
    rows = []
    for code, (active, done) in zips.items():
        rows.append({
            "zip": code,
            "sold_count": len(done),
            "active_count": len(active),
            "median_sold": mid(h["sold_price"] for h in done),
            "median_list": mid(h["price"] for h in active),
            "median_ppsf": mid(h["ppsf"] for h in done or active),
        })
    return sorted(rows, key=lambda r: r["sold_count"], reverse=True)


@app.route("/")
def index():
    """Serve the single-page frontend."""
    return app.send_static_file("index.html")


@app.route("/api/market")
def market():
    """Homes for sale, recently sold homes and statistics for one city."""
    city = " ".join(request.args.get("city", "").split())
    state = request.args.get("state", "").strip().upper()
    if not CITY_PATTERN.match(city):
        return jsonify(error="Please enter a valid city name "
                             "(letters and spaces only)."), 400
    if state not in STATES:
        return jsonify(error="Please choose a US state."), 400

    where = {"city": city.title(), "state_code": state,
             "offset": 0, "limit": RESULT_LIMIT}
    lists, total, warnings = {}, None, []
    for kind in ("for_sale", "sold"):
        try:
            body = dict(where, **SEARCHES[kind])
            raw, count = find_results(call_api(ENDPOINTS["list"], body=body))
            lists[kind] = [normalize(item) for item in raw]
            if kind == "for_sale":
                total = count
        except ApiError as err:
            if err.status in (429, 500):   # no point trying the second call
                return jsonify(error=err.message), err.status
            lists[kind] = []
            warnings.append(err.message)

    for_sale = [h for h in lists["for_sale"] if h["price"]]
    sold = [h for h in lists["sold"] if h["sold_price"]]
    if not for_sale and not sold:
        if warnings:
            return jsonify(error=warnings[0]), 502
        return jsonify(error="No homes found for {}, {}. Check the spelling "
                             "of the city.".format(city.title(), state)), 404
    if warnings:
        warnings = ["Some data could not be loaded, so the results are "
                    "incomplete. " + warnings[0]]

    return jsonify(
        city=city.title(),
        state=state,
        warnings=warnings,
        summary={
            "for_sale_total": to_number(total) or len(for_sale),
            "for_sale_sample": len(for_sale),
            "sold_sample": len(sold),
            "median_list": mid(h["price"] for h in for_sale),
            "median_sold": mid(h["sold_price"] for h in sold),
            "median_ppsf": mid(h["ppsf"] for h in sold or for_sale),
            "median_days": mid(h["days"] for h in sold),
        },
        for_sale=for_sale,
        sold=sold,
        by_type=group_sold(sold, "type"),
        by_beds=group_sold(sold, "beds"),
        by_zip=group_zip(for_sale, sold),
    )


@app.route("/api/property/<property_id>")
def property_detail(property_id):
    """Extra details for one home (description, photos, price history)."""
    if not re.match(r"^[A-Za-z0-9\-]{4,20}$", property_id):
        return jsonify(error="Invalid property id."), 400
    try:
        payload = call_api(ENDPOINTS["detail"],
                           params={"property_id": property_id})
    except ApiError as err:
        return jsonify(error=err.message), err.status
    home = find_home(payload)
    if home is None:
        return jsonify(error="No details are available for this home."), 404

    desc = home.get("description") or {}
    photos = [p.get("href") for p in home.get("photos") or []
              if isinstance(p, dict) and p.get("href")]
    history = [{"date": str(h.get("date") or "")[:10],
                "event": h.get("event_name") or "",
                "price": to_number(h.get("price"))}
               for h in home.get("property_history") or []
               if isinstance(h, dict)]
    return jsonify(
        text=desc.get("text"),
        year_built=to_number(desc.get("year_built")),
        lot_sqft=to_number(desc.get("lot_sqft")),
        garage=to_number(desc.get("garage")),
        stories=to_number(desc.get("stories")),
        photos=photos[:6],
        history=history[:8],
    )


@app.errorhandler(404)
def not_found(_error):
    """Return JSON for unknown API routes."""
    return jsonify(error="Not found."), 404


@app.after_request
def add_headers(response):
    """Add the server name (to see load balancing) and security headers."""
    response.headers["X-Served-By"] = HOSTNAME
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' https: data:")
    return response


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")))
