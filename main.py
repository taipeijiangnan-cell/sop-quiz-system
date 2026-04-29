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

API_KEY = os.getenv("GEMINI_API_KEY")

def init_db():
    conn = sqlite3.connect("quiz_data.db")
    cursor = conn.cursor()
    # 預防舊版本衝突，每次啟動確保資料表結構最新
    cursor.execute("DROP TABLE IF EXISTS records")
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
    return text

@app.post("/generate-quiz")
async def generate_quiz(files: List[UploadFile] = File(...)):
    all_text = ""
    for f in files: 
        all_text += f"\n\n[File: {f.filename}]\n{await extract_text(f)}"
    
    # 強制 AI 使用最嚴格的 JSON 格式
    prompt = f"""請針對內文設計「20題」繁體中文單選題。
    必須嚴格回傳 JSON 陣列格式！不要加上 ```json 標籤，只要純陣列！
    範例：[ {{"q": "題目", "options": {{"A": "選項A", "B": "選項B", "C": "選項C", "D": "選項D"}}, "ans": "A"}} ]
    內容：{all_text[:5000]}"""
    
    url = f"[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=){API_KEY}"
    try:
        res = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=90)
        if res.status_code == 200:
            raw = res.json()['candidates'][0]['content']['parts'][0]['text']
            
            # 暴力清理 Markdown
            match = re.search(r'\[.*\]', raw, re.DOTALL)
            if not match: raise Exception("找不到合法的 JSON 陣列")
            
            parsed = json.loads(match.group())
            
            conn = sqlite3.connect("quiz_data.db")
            old = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
            existing = json.loads(old[0]) if old else []
            
            new_qs = []
            for x in parsed[:20]:
                q_text = str(x.get('q', '無題目'))
                ans_text = str(x.get('ans', 'A')).upper()
                
                # 🌟 終極防呆：不管 AI 給什麼格式的選項，都強制轉成 ABCD 字典
                raw_opts = x.get('options', {})
                opts = {"A": "A", "B": "B", "C": "C", "D": "D"}
                if isinstance(raw_opts, dict):
                    opts["A"] = str(raw_opts.get("A", raw_opts.get("a", "選項A")))
                    opts["B"] = str(raw_opts.get("B", raw_opts.get("b", "選項B")))
                    opts["C"] = str(raw_opts.get("C", raw_opts.get("c", "選項C")))
                    opts["D"] = str(raw_opts.get("D", raw_opts.get("d", "選項D")))
                elif isinstance(raw_opts, list) and len(raw_opts) >= 4:
                    opts["A"], opts["B"], opts["C"], opts["D"] = [str(o) for o in raw_opts[:4]]
                
                new_qs.append({
                    "id": len(existing) + len(new_qs) + 1,
                    "q": q_text,
                    "options": opts,
                    "ans": ans_text
                })
            
            combined = existing + new_qs
            conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(combined),))
            conn.commit(); conn.close()
            return {"status": "ok", "count": len(combined)}
        else:
            raise Exception("API 請求失敗")
    except Exception as e: 
        print(f"生成異常: {e}")
        raise HTTPException(status_code=500, detail="生成失敗")

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
    conn = sqlite3.connect("quiz_data.db")
    recs = conn.execute("SELECT emp_id, name, score, detail FROM records").fetchall()
    conn.close()
    return [{"emp_id": r[0], "name": r[1], "score": r[2], "detail": json.loads(r[3] if r[3] else "[]")} for r in recs]

@app.delete("/admin/records/clear")
async def clear_recs():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM records")
    conn.commit(); conn.close()
    return {"status": "ok"}
