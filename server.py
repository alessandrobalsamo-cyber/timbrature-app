import os, json
from flask import Flask, render_template, request, jsonify
from google.oauth2 import service_account
from googleapiclient.discovery import build

app = Flask(__name__)

SHEET_ID = "1usNDXSwAKnKgEmSlfqfE9HPVsaNZuZ-A_Xk6vM7e9zg"

def get_sheets_service():
    """Costruisce il service Google Sheets usando il service account dalle env vars."""
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON non impostata")
    creds = service_account.Credentials.from_service_account_info(
        json.loads(sa_json),
        scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build("sheets", "v4", credentials=creds)

SCOPRI_COLONNE = {
    "Giorno": 0,
    "Entrata Prevista": 1,
    "Entrata Effettiva": 2,
    "Uscita prevista": 3,
    "Uscita Prevista": 4,
    "Uscita Reale": 5,
    "Ritardo Calcolo": 6,
    "Ritardo Eventuale": 7,
    "Scarto Flessibilità": 8,
    "": 9,
    "Lavoro": 10,
    "Timbrature": 11,
    "Commessa": 12
}

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/sheets")
def api_sheets():
    """Lista dei fogli (mesi)."""
    try:
        service = get_sheets_service()
        ss = service.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
        sheets = [
            {"title": s["properties"]["title"], "index": s["properties"]["index"]}
            for s in ss["sheets"]
        ]
        return jsonify(sheets)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/data/<sheet_name>")
def api_data(sheet_name):
    """Dati di un foglio."""
    try:
        service = get_sheets_service()
        range_name = f"'{sheet_name}'!A1:M40"
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range=range_name,
            valueRenderOption="FORMATTED_VALUE",
            dateTimeRenderOption="FORMATTED_STRING"
        ).execute()
        values = result.get("values", [])

        # Prendi anche le formule per i campi calcolati
        result_f = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range=range_name,
            valueRenderOption="FORMULA"
        ).execute()
        formulas = result_f.get("values", [])

        if len(values) < 2:
            return jsonify({"headers": [], "rows": [], "totals": None})

        headers = values[0]
        rows = []
        totals = None

        for i in range(1, len(values)):
            row = values[i]
            frow = formulas[i] if i < len(formulas) else []
            giorno = str(row[0]).strip() if len(row) > 0 else ""

            if giorno == "" or "flessibilit" in giorno.lower():
                totals = {
                    "flessibilita": row[8] if len(row) > 8 else None,
                    "flessibilitaTesto": row[11] if len(row) > 11 else None
                }
                continue

            rows.append({
                "giorno": row[0] if len(row) > 0 else "",
                "entrataPrevista": row[1] if len(row) > 1 else "",
                "entrataEffettiva": row[2] if len(row) > 2 else "",
                "uscitaPrevista1": row[3] if len(row) > 3 else "",
                "uscitaPrevista2": row[4] if len(row) > 4 else "",
                "uscitaReale": row[5] if len(row) > 5 else "",
                "ritardoCalcolo": row[6] if len(row) > 6 and not frow[6:7] else "",
                "ritardoCalcolo_f": frow[6] if len(frow) > 6 and frow[6] and str(frow[6]).startswith("=") else None,
                "ritardoEventuale": row[7] if len(row) > 7 and not frow[7:8] else "",
                "scartoFlessibilita": row[8] if len(row) > 8 and not frow[8:9] else "",
                "lavoro": row[10] if len(row) > 10 else "",
                "timbrature": row[11] if len(row) > 11 else "",
                "commessa": row[12] if len(row) > 12 else ""
            })

        return jsonify({"headers": headers, "rows": rows, "totals": totals})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/update", methods=["POST"])
def api_update():
    """Aggiorna una cella."""
    try:
        body = request.get_json()
        sheet = body.get("sheet")
        row = body.get("row")  # 1-based (riga nel foglio)
        col = body.get("col")  # 1-based
        value = body.get("value", "")

        service = get_sheets_service()
        range_name = f"'{sheet}'!{chr(64 + col)}{row}"
        service.spreadsheets().values().update(
            spreadsheetId=SHEET_ID, range=range_name,
            valueInputOption="USER_ENTERED",
            body={"values": [[value]]}
        ).execute()

        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/recalc")
def api_recalc():
    """Legge i totali aggiornati (le formule si ricalcolano automaticamente)."""
    try:
        service = get_sheets_service()
        # Trova i fogli
        ss = service.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
        # Legge l'ultima riga di ogni foglio
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/today")
def api_today():
    from datetime import datetime
    now = datetime.now()
    return jsonify({
        "day": now.day,
        "month": now.month,
        "year": now.year,
        "monthName": now.strftime("%B"),
        "hour": now.hour,
        "minute": now.minute
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)