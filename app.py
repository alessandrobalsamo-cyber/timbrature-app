import os
import json
from datetime import datetime

from flask import Flask, render_template, request, jsonify
from google.oauth2 import service_account
from googleapiclient.discovery import build

app = Flask(__name__)

SHEET_ID = "1usNDXSwAKnKgEmSlfqfE9HPVsaNZuZ-A_Xk6vM7e9zg"

MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
          "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]

WORK_TARGET_HOURS = 8.75

_service = None


def get_service():
    global _service
    if _service is None:
        sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if not sa_json:
            raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON non impostata")
        creds = service_account.Credentials.from_service_account_info(
            json.loads(sa_json),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        _service = build("sheets", "v4", credentials=creds)
    return _service


def col_letter(idx):
    """Converte un indice di colonna 0-based in lettera (0 -> A, 13 -> N)."""
    idx += 1
    s = ""
    while idx > 0:
        idx, r = divmod(idx - 1, 26)
        s = chr(65 + r) + s
    return s


def header_map(headers):
    m = {}
    for i, h in enumerate(headers):
        if not h:
            continue
        key = str(h).strip()
        if key not in m:
            m[key] = i
    return m


def to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".")
    if s == "" or s.startswith("#"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def get_cell(row, hmap, *names, default=""):
    for name in names:
        i = hmap.get(name)
        if i is not None and i < len(row):
            val = row[i]
            if val != "":
                return val
    return default


def fetch_month(service, name):
    """Legge un foglio mensile e restituisce (hmap, rows, totals)."""
    rng = f"'{name}'!A1:N40"
    res = service.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=rng,
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    values = res.get("values", [])
    if not values:
        return None, [], None

    headers = values[0]
    hmap = header_map(headers)
    rows = []
    totals = None

    for r in values[1:]:
        giorno_idx = hmap.get("Giorno", 0)
        giorno_raw = r[giorno_idx] if giorno_idx < len(r) else ""
        giorno_str = str(giorno_raw).strip()

        if giorno_str == "":
            continue

        if "flessibilit" in giorno_str.lower():
            totals = {
                "scarto": to_float(get_cell(r, hmap, "Scarto Flessibilità")),
                "text": get_cell(r, hmap, "Timbrature", default=None),
            }
            continue

        rows.append({
            "giorno": giorno_raw,
            "entrataPrevista": get_cell(r, hmap, "Entrata Prevista"),
            "entrataEffettiva": get_cell(r, hmap, "Entrata Effettiva"),
            "uscitaPrevista": get_cell(r, hmap, "Uscita Prevista", "Uscita prevista"),
            "uscitaReale": get_cell(r, hmap, "Uscita Reale"),
            "ritardo": get_cell(r, hmap, "Ritardo Eventuale", "Ritardo Calcolo"),
            "scarto": to_float(get_cell(r, hmap, "Scarto Flessibilità")),
            "lavoro": get_cell(r, hmap, "Lavoro"),
            "timbrature": get_cell(r, hmap, "Timbrature"),
            "commessa": get_cell(r, hmap, "Commessa"),
        })

    return hmap, rows, totals


def list_months(service):
    ss = service.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
    sheets = [s["properties"]["title"] for s in ss["sheets"]]
    return [m for m in MONTHS if m in sheets]


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return app.send_static_file("manifest.json")


@app.route("/sw.js")
def service_worker():
    return app.send_static_file("sw.js")


@app.route("/api/months")
def api_months():
    try:
        service = get_service()
        return jsonify(list_months(service))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/month/<name>")
def api_month(name):
    try:
        service = get_service()
        hmap, rows, totals = fetch_month(service, name)
        if hmap is None:
            return jsonify({"error": "foglio non trovato"}), 404
        return jsonify({"rows": rows, "totals": totals})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/update", methods=["POST"])
def api_update():
    try:
        body = request.get_json()
        name = body["sheet"]
        giorno = int(body["giorno"])
        field = body["field"]
        value = body.get("value", "")

        field_map = {"entrata": "Entrata Effettiva", "uscita": "Uscita Reale"}
        col_name = field_map.get(field)
        if col_name is None:
            return jsonify({"error": "campo non valido"}), 400

        service = get_service()
        res = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range=f"'{name}'!A1:N1",
        ).execute()
        headers = res.get("values", [[]])[0]
        hmap = header_map(headers)
        if col_name not in hmap:
            return jsonify({"error": f"colonna '{col_name}' non trovata"}), 400

        col = hmap[col_name]
        row_num = giorno + 1  # riga 1 = intestazione, giorno 1 -> riga 2
        rng = f"'{name}'!{col_letter(col)}{row_num}"
        service.spreadsheets().values().update(
            spreadsheetId=SHEET_ID, range=rng,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]},
        ).execute()

        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/overview")
def api_overview():
    try:
        service = get_service()
        months = list_months(service)
        now = datetime.now()

        result_months = []
        daily_series = []
        today_data = None
        today_month = None

        for name in months:
            hmap, rows, totals = fetch_month(service, name)
            month_idx = MONTHS.index(name)

            worked = 0
            ferie = 0
            sw = 0
            total_scarto = 0.0

            for r in rows:
                try:
                    gi = int(float(r["giorno"]))
                except (TypeError, ValueError):
                    continue

                lavoro = (r["lavoro"] or "")
                lavoro_l = lavoro.lower()
                if "ferie" in lavoro_l:
                    ferie += 1
                if lavoro_l.startswith("sw") or " sw " in f" {lavoro_l} ":
                    sw += 1

                if r["entrataEffettiva"]:
                    worked += 1
                    if r["scarto"] is not None:
                        total_scarto += r["scarto"]
                    daily_series.append({
                        "date": f"{now.year}-{month_idx + 1:02d}-{gi:02d}",
                        "label": f"{gi}/{month_idx + 1}",
                        "scarto": r["scarto"],
                        "month": name,
                        "day": gi,
                        "anomaly": r["scarto"] is not None and abs(r["scarto"]) >= 4,
                    })

                if month_idx == now.month - 1 and gi == now.day:
                    today_data = r
                    today_month = name

            result_months.append({
                "name": name,
                "totalScarto": round(total_scarto, 2),
                "workedDays": worked,
                "ferieDays": ferie,
                "swDays": sw,
                "totalsText": totals.get("text") if totals else None,
            })

        cumulative = 0.0
        for d in daily_series:
            if d["scarto"] is not None:
                cumulative += d["scarto"]
            d["cumulative"] = round(cumulative, 2)

        return jsonify({
            "months": result_months,
            "dailySeries": daily_series,
            "today": today_data,
            "todayMonth": today_month,
            "now": {"day": now.day, "month": now.month, "year": now.year,
                    "monthName": MONTHS[now.month - 1],
                    "weekday": now.weekday()},
            "targetHours": WORK_TARGET_HOURS,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/now")
def api_now():
    now = datetime.now()
    return jsonify({
        "day": now.day, "month": now.month, "year": now.year,
        "monthName": MONTHS[now.month - 1],
        "time": now.strftime("%H:%M"),
        "weekday": now.weekday(),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
