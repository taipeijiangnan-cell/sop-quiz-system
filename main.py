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

# 抓取 Groq 金鑰
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()

def init_db():
    conn = sqlite3.connect("quiz_data.db")
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS temp_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS final_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS records (emp_id TEXT PRIMARY KEY, name TEXT, score INTEGER, detail TEXT)")
    
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
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="遺失 GROQ_API_KEY！請檢查 Render 環境變數。")

    all_text = ""
    for f in files: 
        extracted = await extract_text(f)
        if extracted.strip():
            all_text += f"\n\n[File: {f.filename}]\n{extracted}"
            
    if len(all_text.strip()) < 50:
        raise HTTPException(status_code=400, detail="檔案內文太少或無法解析文字！請確認您的 PDF 是「可以反白複製文字」的檔案，而不是純圖片掃描檔。")
    
    # 🌟 重度優化的 System Prompt：建立「出題思維框架」
    system_prompt = """你是一位專業的「門市 SOP 培訓大師」。你的任務是將【文件內容】轉化為精準、有意義的員工測驗題。

    【🔴 嚴格禁止的行為（防幻覺機制）】
    1. 絕對禁止：考無意義的文字遊戲（例如：文件中出現幾次某個字、某句話的單位是什麼）。
    2. 絕對禁止：出數學題（例如：什麼是2的倍數）。
    3. 絕對禁止：超出文件範圍的生活常識題。
    4. 所有的題目與選項，必須 100% 來自【文件內容】。如果無法出滿 20 題有意義的題目，寧可減少題數，絕對不能為了湊數而出爛題！

    【🟢 出題策略與範例（請參考此框架出題）】
    請將焦點放在「操作規範」、「配方比例」、「時間溫度」與「效期管理」上：
    - 考「配方量」：
      （O）製作【黑桑莓莓沙沙】時，混合果醬應加入多少克？
      （X）文件中提到的果醬重量單位是什麼？
    - 考「效期規範」：
      （O）根據規定，冷藏退冰的檸檬汁效期為幾天？
      （X）文件中哪個日期是到期日？
    - 考「操作步驟」：
      （O）煮製檸檬凍時，加入檸檬汁後，電磁爐應設定多少火力？
    - 考「器具使用」：
      （O）製作檸檬凍時，過濾的步驟應使用什麼器具？

    【✅ 輸出格式規範】
    必須嚴格以 JSON 物件格式回傳，且包含一個名為 "quiz" 的陣列。
    格式範例：
    {
      "quiz": [
        {
          "q": "根據 SOP，製作檸檬凍時，加入檸檬汁後需以火力 1500(P4) 煮至沸騰，隨後應計時多久即可關火？",
          "options": {"A": "10秒", "B": "30秒", "C": "1分鐘", "D": "2分鐘"},
          "ans": "B"
        }
      ]
    }"""

    # 🌟 再次強調「寧缺勿濫」，並鼓勵挖掘細節
    user_prompt = f"請根據以下【文件內容】，針對配方、時間、效期、器具等細節，設計出最多 20 題的繁體中文單選題。請盡量涵蓋不同面向，但若內容不足以出 20 題高品質的題目，請只回傳有意義的題目即可，寧缺勿濫。\n\n【文件內容開始】\n{all_text[:8000]}\n【文件內容結束】"
    
    url = "https://api.com/v1/chat/completions".replace("api.com", "api.groq.com/openai")
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1, 
        "response_format": {"type": "json_object"}
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload, timeout=90)
        if res.status_code != 200:
            raise Exception(f"Groq API 錯誤: {res.text}")
            
        raw_content = res.json()['choices'][0]['message']['content']
        
        try:
            parsed_json = json.loads(raw_content)
            parsed = parsed_json.get("quiz", [])
            if not parsed and isinstance(parsed_json, list):
                parsed = parsed_json
            elif not parsed:
                for k, v in parsed_json.items():
                    if isinstance(v, list):
                        parsed = v
                        break
        except Exception as e:
            raise Exception(f"JSON 解析失敗，AI 回覆了看不懂的格式。前50字：{raw_content[:50]}")
            
        if not parsed or not isinstance(parsed, list):
            raise Exception("AI 沒有回傳有效的題目列表，請再試一次。")
        
        conn = sqlite3.connect("quiz_data.db")
        old = conn.execute("SELECT data FROM temp_qs WHERE id=1").fetchone()
        existing = json.loads(old[0]) if old else []
        
        new_qs = []
        for x in parsed[:20]: # 擷取最多 20 題
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
        conn.commit(); conn.close()
        return {"status": "ok", "count": len(combined)}
    except Exception as e: 
        print(f"Groq 處理異常: {str(e)}")
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
