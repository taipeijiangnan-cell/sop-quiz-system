from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import json, io, pypdf, docx, requests, sqlite3, re, os, random
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 抓取 API 金鑰
API_KEY = os.getenv("GEMINI_API_KEY", "")

def init_db():
    conn = sqlite3.connect("quiz_data.db")
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS temp_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS final_qs (id INTEGER PRIMARY KEY, data TEXT)")
    
    # 建立包含 detail 欄位的新版資料表
    cursor.execute("CREATE TABLE IF NOT EXISTS records (emp_id TEXT PRIMARY KEY, name TEXT, score INTEGER, detail TEXT)")
    
    # 自動升級防護罩
    try:
        cursor.execute("SELECT detail FROM records LIMIT 1")
    except sqlite3.OperationalError:
        cursor.execute("DROP TABLE IF EXISTS records")
        cursor.execute("CREATE TABLE IF NOT EXISTS records (emp_id TEXT PRIMARY KEY, name TEXT, score INTEGER, detail TEXT)")
        
    conn.commit()
    conn.close()

init_db()

async def extract_text(file: UploadFile):
    content = await file.read()
    text = ""
    try:
        if file.filename.lower().endswith(".pdf"):
            reader = pypdf.PdfReader(io.BytesIO(content))
            for page in reader.pages: text += (page.extract_text() or "") + "\n"
        elif file.filename.lower().endswith(".docx"):
            doc = docx.Document(io.BytesIO(content))
            for p in doc.paragraphs: text += p.text + "\n"
        else: text += content.decode("utf-8")
    except Exception as e: print(f"檔案解析錯誤: {e}")
    return text

@app.post("/generate-quiz")
async def generate_quiz(files: List[UploadFile] = File(...)):
    # 🌟 防呆第一層：檢查金鑰是否存在
    if not API_KEY or API_KEY.strip() == "":
        raise HTTPException(status_code=500, detail="伺服器遺失 API 金鑰！請至 Render 的 Environment 檢查 GEMINI_API_KEY 是否填寫正確。")

    all_text = ""
    for f in files: 
        all_text += f"\n\n[File: {f.filename}]\n{await extract_text(f)}"
    
    prompt = f"""請針對內文設計「20題」繁體中文單選題。
    必須嚴格回傳 JSON 陣列格式！不要加上任何 markdown 標籤，只要純陣列！
    範例：[ {{"q": "題目", "options": {{"A": "選項A", "B": "選項B", "C": "選項C", "D": "選項D"}}, "ans": "A"}} ]
    內容：{all_text[:5000]}"""
    
    # 🌟 修正模型名稱：改為 Google 官方目前支援的 -latest 後綴版本
    # 將網址切成兩段，防止編輯器雞婆幫忙加上 Markdown 超連結
    host = "https://generativelanguage.googleapis.com"
    path = "/v1beta/models/gemini-1.5-flash-latest:generateContent?key="
    url = host + path + API_KEY.strip()
    
    try:
        res = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=90)
        if res.status_code != 200:
            # 🌟 防呆第三層：直接把 Google 拒絕的真實原因抓出來顯示給店長看
            err_detail = res.json().get('error', {}).get('message', res.text)
            print(f"API錯誤: {err_detail}")
            raise Exception(f"Google API 錯誤 (代碼: {res.status_code}) - 詳細原因: {err_detail}")
            
        data = res.json()
        if "candidates" not in data or not data["candidates"]:
            raise Exception("AI 沒有回傳任何題目，可能是內容觸發了安全阻擋機制。")
            
        raw = data['candidates'][0]['content']['parts'][0]['text']
        
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if not match: 
            raise Exception("AI 回傳的格式嚴重錯亂，找不到合法的 JSON。請再試一次。")
        
        parsed = json.loads(match.group())
        
        conn = sqlite3.connect("quiz_data.db")
        old = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
        existing = json.loads(old[0]) if old else []
        
        new_qs = []
        for x in parsed[:20]:
            opts = {"A": "A", "B": "B", "C": "C", "D": "D"}
            raw_opts = x.get('options', {})
            if isinstance(raw_opts, dict):
                opts["A"] = str(raw_opts.get("A", raw_opts.get("a", "選項A")))
                opts["B"] = str(raw_opts.get("B", raw_opts.get("b", "選項B")))
                opts["C"] = str(raw_opts.get("C", raw_opts.get("c", "選項C")))
                opts["D"] = str(raw_opts.get("D", raw_opts.get("d", "選項D")))
            
            new_qs.append({
                "id": len(existing) + len(new_qs) + 1,
                "q": str(x.get('q', '無題目')),
                "options": opts,
                "ans": str(x.get('ans', 'A')).upper()
            })
        
        combined = existing + new_qs
        conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(combined),))
        conn.commit()
        conn.close()
        return {"status": "ok", "count": len(combined)}
    except Exception as e: 
        print(f"生成異常: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/admin/temp-clear")
async def clear_temp():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM temp_qs")
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/get-questions")
async def get_qs(emp_id: str):
    conn = sqlite3.connect("quiz_data.db")
    if conn.execute("SELECT score FROM records WHERE emp_id=?", (emp_id,)).fetchone():
        conn.close(); raise HTTPException(status_code=403, detail="此工號已完成考核")
    data = conn.execute("SELECT data FROM final_qs WHERE id=1").fetchone()
    conn.close()
    if not data: raise HTTPException(status_code=400, detail="題庫未就緒")
    
    all_qs = json.loads(data[0])
    return random.sample(all_qs, min(20, len(all_qs)))

@app.post("/submit")
async def submit(data: dict):
    name, emp_id, score, detail = data.get("user_name"), data.get("emp_id"), data.get("score"), data.get("detail")
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("INSERT OR REPLACE INTO records (emp_id, name, score, detail) VALUES (?, ?, ?, ?)", (emp_id, name, score, json.dumps(detail)))
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/admin/current-final")
async def get_final():
    conn = sqlite3.connect("quiz_data.db")
    data = conn.execute("SELECT data FROM final_qs WHERE id=1").fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.get("/admin/temp-questions")
async def get_temp():
    conn = sqlite3.connect("quiz_data.db")
    data = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.post("/admin/publish-questions")
async def publish(data: List[dict]):
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM final_qs")
    conn.execute("DELETE FROM temp_qs")
    conn.execute("INSERT INTO final_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/admin/records")
async def get_recs():
    try:
        conn = sqlite3.connect("quiz_data.db")
        recs = conn.execute("SELECT emp_id, name, score, detail FROM records").fetchall()
        conn.close()
        
        result = []
        for r in recs:
            try:
                det = json.loads(r[3]) if r[3] else []
            except:
                det = []
            result.append({"emp_id": r[0], "name": r[1], "score": r[2], "detail": det})
        return result
    except Exception as e:
        print(f"讀取成績發生錯誤: {e}")
        return []

@app.delete("/admin/records/clear")
async def clear_recs():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM records")
    conn.commit(); conn.close()
    return {"status": "ok"}
