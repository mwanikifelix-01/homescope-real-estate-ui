# HomeScope

HomeScope is a small web app that helps people understand a US housing market before they buy or invest. You type a city and a state, and it shows:

- **Homes** – homes for sale and recently sold homes, which you can search, filter and sort.
- **What sells best** – which home types and bedroom counts sell the most, their median sold price and how many days they take to sell.
- **Where to invest** – a sortable table that compares the ZIP codes of the city (recent sales, homes on the market, median prices, price per square foot), plus a table that compares all the cities you searched.

Clicking a home opens its details (photos, description, year built, price history).

- **Live site (load balancer):** `http://35.176.54.28//`
- **Demo video:** `<LINK_TO_VIDEO>`  <!-- TODO: add your link -->

## How it works

```
Browser (HTML/CSS/JS)  ->  Flask server (app.py)  ->  Realty in US API (RapidAPI)
```

The browser never talks to RapidAPI directly. The Flask server adds the API key, calls the API, calculates the statistics and sends clean JSON back. This keeps the API key secret.

| File | Purpose |
|---|---|
| `app.py` | Flask server: API calls, caching, statistics, input validation |
| `static/index.html` | Page structure |
| `static/style.css` | Styles |
| `static/app.js` | Search, filters, sorting, charts and tables |
| `.env.example` | Template for the secret `.env` file |

## API used

**Realty in US API** by *APIdojo*, on RapidAPI: <https://rapidapi.com/apidojo/api/realty-in-us>

| Endpoint | Used for |
|---|---|
| `POST /properties/v3/list` with `"status": ["for_sale"]` | Homes currently for sale in a city |
| `POST /properties/v3/list` with `"status": ["sold"]` | Recently sold homes in a city |
| `GET /properties/v3/detail` | Details of one home |

Thank you to the API developers. The listing data and photos belong to their original sources.

## Run it locally

You need Python 3.8 or newer and a RapidAPI key (subscribe to the API on the page linked above; there is a free plan).

```bash
git clone <YOUR_REPO_URL>
cd <YOUR_REPO_NAME>
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then open .env and paste your RapidAPI key
python3 app.py
```

Open <http://127.0.0.1:5000> and search, for example, `Austin` + `TX`.

## Features

- **Search** homes by address or ZIP code.
- **Filter** by status (for sale / sold), home type, minimum bedrooms and maximum price.
- **Sort** by price, price per sqft, size or days on market; sort the ZIP table by any column.
- **Error handling** – clear messages for an invalid city, no results, API down, API timeout, rejected key and exceeded quota. If only one of the two API calls fails, the app still shows the data it has and displays a warning.
- **Caching** – API responses are cached in server memory for one hour (`CACHE_TTL`), so repeated searches are instant and do not use the API quota.
- **Security** – the API key is only in `.env` (ignored by git); user input is validated on the server; API text is inserted with `textContent`, never `innerHTML`, to prevent XSS; a Content-Security-Policy header is set.

## Deployment

The app runs on **Web01** and **Web02** (Gunicorn behind Nginx) and **Lb01** distributes traffic between them with HAProxy.

### 1. On both web servers (Web01 and Web02)

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip nginx git
sudo git clone <YOUR_REPO_URL> /var/www/homescope
sudo chown -R $USER:$USER /var/www/homescope
cd /var/www/homescope
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env      # paste the RapidAPI key
```

Create a service so the app starts on boot and restarts if it crashes — `/etc/systemd/system/homescope.service`:

```ini
[Unit]
Description=HomeScope (Gunicorn)
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/var/www/homescope
ExecStart=/var/www/homescope/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:8000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now homescope
```

Make Nginx forward requests to Gunicorn — `/etc/nginx/sites-available/default`:

```nginx
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo nginx -t && sudo systemctl restart nginx
curl -I http://localhost/        # should print "200 OK" and an X-Served-By header
```

### 2. On the load balancer (Lb01)

```bash
sudo apt update
sudo apt install -y haproxy
```

Add this to the end of `/etc/haproxy/haproxy.cfg` (use your own server IPs):

```haproxy
frontend homescope_front
    bind *:80
    default_backend homescope_back

backend homescope_back
    balance roundrobin
    option httpchk GET /
    server web01 <WEB01_IP>:80 check
    server web02 <WEB02_IP>:80 check
```

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg   # check the file is valid
sudo systemctl restart haproxy
```

- `balance roundrobin` sends requests to Web01 and Web02 in turn.
- `check` + `option httpchk` test each server regularly. If one server is down, HAProxy sends all traffic to the other one, so the site stays online.

### 3. Test the load balancer

Every response has an `X-Served-By` header with the name of the server that answered (it is also shown at the bottom of the page).

```bash
for i in 1 2 3 4; do curl -sI http://<LB01_IP>/ | grep -i x-served-by; done
```

The output should alternate between the two servers. Then stop one server (`sudo systemctl stop nginx` on Web01), repeat the command and confirm that the site still works through Web02. Start Nginx again afterwards.

### Updating the site

```bash
cd /var/www/homescope && git pull && sudo systemctl restart homescope
```

Do this on one web server at a time, so the other one keeps serving users.

## Challenges

<!-- TODO: replace with your own experience. Ideas from how the app is built: -->
- **Keeping the API key secret.** A frontend-only app would show the key to anyone who opens the browser's developer tools, so a small Flask server calls the API instead.
- **Limited API quota.** Each search needs two API calls, so responses are cached on the server.
- **Missing data.** Many listings have no size, photo or listing date. Statistics use medians and skip missing values, and sorting puts homes with missing values last.
- **Cache per server.** Each web server has its own in-memory cache, so the first search of a city on each server is slower than the following ones.

## Limitations

Statistics are calculated from a sample of up to 200 current listings and 200 recent sales per city, so they are estimates. HomeScope is a research tool and does not give financial advice.

## Credits

- [Realty in US API](https://rapidapi.com/apidojo/api/realty-in-us) by APIdojo (RapidAPI)
- [Flask](https://flask.palletsprojects.com/), [Requests](https://requests.readthedocs.io/), [python-dotenv](https://github.com/theskumar/python-dotenv), [Gunicorn](https://gunicorn.org/)
- [Nginx](https://nginx.org/) and [HAProxy](https://www.haproxy.org/)
