from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import json, io, pypdf, docx, requests, sqlite3, re, os, random
from typing import List

app = FastAPI(title="考核系統後端")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()

def init_db():
    conn = sqlite3.connect("quiz_data.db")
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS temp_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS final_qs (id INTEGER PRIMARY KEY, data TEXT)")
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
    text = re.sub(r'[\r\t]+', ' ', text)
    text = re.sub(r'(.)\1{4,}', '', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    return text

@app.post("/generate-quiz")
async def generate_quiz(files: List[UploadFile] = File(...)):
    if not GROQ_API_KEY: raise HTTPException(status_code=500, detail="遺失 GROQ_API_KEY")
    all_text = ""
    for f in files: 
        extracted = await extract_text(f)
        if extracted.strip(): all_text += extracted
            
    if len(all_text.strip()) < 30: raise HTTPException(status_code=400, detail="無法讀取文字")
    
    system_prompt = """你是一個完全沒有記憶的出題機器人。只准根據提供的內容出題，禁止幻想不存在的節日或產品。
    直接以 JSON 陣列格式輸出。"""

    user_prompt = f"請根據以下內容設計 20 題繁體中文單選題：\n\n{all_text[:4500]}\n\n直接輸出 [ {{...}} ] 格式。"
    
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        "temperature": 0.0,
        "max_tokens": 3500
    }
    
    try:
        res = requests.post(url, headers={"Authorization": f"Bearer {GROQ_API_KEY}"}, json=payload, timeout=120)
        raw_content = res.json()['choices'][0]['message']['content']
        parsed = []
        starts = [m.start() for m in re.finditer(r'\{\s*"(q|question|題目)"\s*:', raw_content)]
        for start in starts:
            depth = 0
            for i in range(start, len(raw_content)):
                if raw_content[i] == '{': depth += 1
                elif raw_content[i] == '}':
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(raw_content[start:i+1])
                            if "options" in obj and "ans" in obj: parsed.append(obj)
                        except: pass
                        break
        
        conn = sqlite3.connect("quiz_data.db")
        old = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
        existing = json.loads(old[0]) if old else []
        new_qs = [{"id": len(existing)+i+1, "q": x.get('q', x.get('question','')), "options": x.get('options',{}), "ans": str(x.get('ans','A')).upper()} for i, x in enumerate(parsed[:20])]
        combined = existing + new_qs
        conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(combined),))
        conn.commit(); conn.close()
        return {"status": "ok", "count": len(combined)}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# 🌟 新增：手動儲存草稿接口
@app.post("/admin/save-temp")
async def save_temp(data: List[dict]):
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/admin/temp-questions")
async def get_temp():
    conn = sqlite3.connect("quiz_data.db")
    data = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.delete("/admin/temp-clear")
async def clear_temp():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM temp_qs")
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.post("/admin/publish-questions")
async def publish(data: List[dict]):
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM final_qs")
    conn.execute("INSERT INTO final_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
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
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("INSERT OR REPLACE INTO records (emp_id, name, score, detail) VALUES (?, ?, ?, ?)", (data['emp_id'], data['name'], data['score'], json.dumps(data['detail'])))
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/admin/current-final")
async def get_final():
    conn = sqlite3.connect("quiz_data.db")
    data = conn.execute("SELECT data FROM final_qs WHERE id=1").fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.get("/admin/records")
async def get_recs():
    conn = sqlite3.connect("quiz_data.db")
    recs = conn.execute("SELECT emp_id, name, score, detail FROM records").fetchall()
    conn.close()
    return [{"emp_id": r[0], "name": r[1], "score": r[2], "detail": json.loads(r[3])} for r in recs]

@app.delete("/admin/records/clear")
async def clear_recs():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM records")
    conn.commit(); conn.close()
    return {"status": "ok"}
