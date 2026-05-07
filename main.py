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
    
    # 🌟 自動升級舊版資料庫：如果發現是舊版(沒有 detail 欄位)，就砍掉重建
    try:
        cursor.execute("SELECT detail FROM records LIMIT 1")
    except sqlite3.OperationalError:
        cursor.execute("DROP TABLE IF EXISTS records")
        
    # 確保成績紀錄的欄位完全正確
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
            for page in reader.pages: 
                t = page.extract_text() or ""
                text += t + "\n"
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
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="遺失 GROQ_API_KEY！")

    all_text = ""
    for f in files: 
        extracted = await extract_text(f)
        if extracted.strip():
            all_text += extracted
            
    if len(all_text.strip()) < 30:
        raise HTTPException(status_code=400, detail="無法讀取檔案文字！")
    
    system_prompt = """你是一個完全沒有記憶的「再睡5分鐘」門市出題機器人。
    【絕對準則】
    1. 你的世界只有我提供的【文件內容】。禁止使用任何外部知識或聯想。
    2. 禁止幻想！絕對不准發明不存在的節日或日期。
    3. 每個題目和選項都必須在文件中找到「精準對應的原始字句」。
    4. 所有的選項必須具體，禁止使用「以上皆是」、「未指定」或模糊敘述。
    5. 必須嚴格以 JSON 陣列格式輸出。

    【✅ 輸出格式】
    [
      { "q": "具體問題？", "options": {"A": "選項", "B": "選項", "C": "選項", "D": "選項"}, "ans": "A" }
    ]"""

    user_prompt = f"請根據以下【文件內容】，設計 20 題繁體中文單選題。不准幻想！\n\n【文件內容】\n{all_text[:3000]}\n\n請直接輸出 JSON 陣列，第一個字元必須是 [。"
    
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 2500,
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload, timeout=120)
        if res.status_code != 200:
            err_msg = res.json().get('error', {}).get('message', res.text)
            raise Exception(f"Groq API 錯誤: {err_msg}")
            
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
                        
        if not parsed:
            raise Exception("AI 生成題目失敗，請確認檔案內容或稍後再試。")
        
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
            
            q_text = str(x.get('q', x.get('question', '無題目')))
            new_qs.append({
                "id": len(existing) + len(new_qs) + 1,
                "q": q_text,
                "options": opts,
                "ans": str(x.get('ans', 'A')).upper()
            })
        
        combined = existing + new_qs
        conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(combined),))
        conn.commit(); conn.close()
        return {"status": "ok", "count": len(combined)}
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/admin/temp-clear")
async def clear_temp():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM temp_qs")
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.post("/admin/save-temp")
async def save_temp(data: List[dict]):
    try:
        conn = sqlite3.connect("quiz_data.db")
        conn.execute("INSERT OR REPLACE INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

# 🌟 強化版交卷通道：確保欄位不會遺漏而崩潰
@app.post("/submit")
async def submit(data: dict):
    try:
        name = data.get("user_name", "未知姓名")
        emp_id = data.get("emp_id", "未知工號")
        score = data.get("score", 0)
        detail = data.get("detail", [])
        
        conn = sqlite3.connect("quiz_data.db")
        conn.execute("INSERT OR REPLACE INTO records (emp_id, name, score, detail) VALUES (?, ?, ?, ?)", (emp_id, name, score, json.dumps(detail)))
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        print(f"Submit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
    try:
        conn = sqlite3.connect("quiz_data.db")
        conn.execute("DELETE FROM final_qs")
        conn.execute("INSERT INTO final_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/admin/records")
async def get_recs():
    try:
        conn = sqlite3.connect("quiz_data.db")
        recs = conn.execute("SELECT emp_id, name, score, detail FROM records").fetchall()
        conn.close()
        result = []
        for r in recs:
            try: det = json.loads(r[3]) if r[3] else []
            except: det = []
            result.append({"emp_id": r[0], "name": r[1], "score": r[2], "detail": det})
        return result
    except: return []

@app.delete("/admin/records/clear")
async def clear_recs():
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM records")
    conn.commit(); conn.close()
    return {"status": "ok"}
