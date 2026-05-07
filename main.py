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
    
    # 🌟 特化指令：強制出滿 20 題，並教導 AI 如何從 SOP 挖掘細節
    system_prompt = """你是一位極度嚴格且專業的「門市 SOP 考核出題大師」。
    你的任務是從我提供的【文件內容】中，仔細挖掘每一個專業細節，設計出「剛好 20 題」單選題。

    【🔴 絕對禁止的行為 - 觸犯將視為重大失誤】
    1. 絕對禁止出數學計算題（例如：什麼是 2 的倍數、1+1 等）。
    2. 絕對禁止憑空捏造常識題或文件沒有提到的內容。
    3. 所有的題目、正確答案與錯誤選項，都必須合理，且正確答案 100% 來自【文件內容】。

    【🟢 為了湊滿 20 題的「細節挖掘」策略】
    請把文件當作放大鏡來看，同一個產品可以拆成多個不同的考題：
    - 考「公克數(g)」：例如配料要加多少克？容許的正負值是多少？
    - 考「毫升(ml)」或「溫度」：例如熱水要加多少？
    - 考「時間」：例如計時要多久？冷藏/退冰要幾小時？靜置幾分鐘？
    - 考「器具」：例如要使用哪種工具（打蛋器、篩網、蚵撈）？
    - 考「火力/機器設定」：例如電磁爐火力要設定多少（P4/1500）？
    - 考「步驟順序」：例如哪個動作必須先做？

    【✅ 輸出格式規範】
    必須嚴格以 JSON 物件格式回傳，且包含一個名為 "quiz" 的陣列，陣列內必須剛好包含 20 個題目物件。
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

    # 🌟 明確要求 20 題
    user_prompt = f"請根據以下【文件內容】，徹底挖掘所有數字、步驟與器具細節，設計出「剛好 20 題」的繁體中文單選題。請務必出滿 20 題！\n\n【文件內容開始】\n{all_text[:8000]}\n【文件內容結束】"
    
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
        "temperature": 0.1, # 🌟 給一點點溫度(0.1)，讓它有微小的彈性可以換句話說來湊滿 20 題，但依然極度嚴謹
        "response_format": {"type": "json_object"}
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload, timeout=90) # 20題需要較長時間，將 timeout 延長至 90 秒
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
