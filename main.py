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
            all_text += f"\n\n{extracted}"
            
    if len(all_text.strip()) < 50:
        raise HTTPException(status_code=400, detail="檔案內文太少或無法解析文字！請確認您的 PDF 是「可以反白複製文字」的檔案，而不是純圖片掃描檔。")
    
    # 🌟 全適應模式：讓 AI 自動判斷文件類型，出符合情境的題目
    system_prompt = """你是一位極度專業的「連鎖門市考核出題總監」。
    你的任務是先「分析文件屬性」，然後精準地將【文件內容】轉化為員工測驗題。

    【🔴 嚴重違規行為（絕對禁止，觸犯視為不及格）】
    1. 絕對禁止在開頭加上任何檔名、標題或說明！
    2. 題目缺少主詞與情境：必須明確寫出完整情境與專有名詞（如：某活動名稱、某飲品名稱）。
    3. 題目重複：考點必須【完全不重複】。
    4. 禁用模糊代名詞與敷衍選項：禁止使用「某產品」、「該活動」、「上述」。選項必須是具體的做法或數字，禁止「未指定」、「以上皆是」、「以上皆非」。
    5. 禁止常識題與過度抽象的行政題（例如：應進行哪些工作？）。所有的考題必須是「具體的操作、數值、日期或規範」。

    【🟢 動態適應出題策略 (完美達成 20 題且不重複)】
    請先分析這份文件的主要內容是「飲品配方」、「行銷活動」、「還是設備維護」，並根據其屬性出題：
    - 若為【行銷活動/話術】：請考「活動起始日期」、「特定條件（滿多少錢/送什麼）」、「POS機按法/結帳流程」、「顧客回應話術」、「優惠是否可併用」。
    - 若為【飲品配方/SOP】：請考「精準克數(g)/毫升(ml)」、「溫度/時間/火力」、「機器按鍵」、「保存期限(D+X)」。
    
    請盡可能從上述具體的面向，挖掘出 20 題高品質的題目。

    【✅ 輸出格式規範】
    請直接以 JSON 陣列格式回傳，陣列內包含 20 個題目物件。
    格式範例：
    [
      {
        "q": "根據「愚人節活動」規範，當顧客購買茶泡飯奶蓋時，門市夥伴應該主動說什麼話術？",
        "options": {"A": "歡迎光臨", "B": "愚人節快樂", "C": "需要加購塑膠袋嗎", "D": "這杯不能調甜度喔"},
        "ans": "B"
      }
    ]"""

    user_prompt = f"請根據以下【文件內容】，設計「20 題」繁體中文單選題。\n\n【文件內容開始】\n{all_text[:4500]}\n【文件內容結束】\n\n【最後警告】：請直接從 [ {{ \"q\": ... 開始輸出，絕對不要加任何廢話！"
    
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
        "temperature": 0.3, 
        "max_tokens": 3500 
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload, timeout=120)
        
        if res.status_code != 200:
            err_msg = res.json().get('error', {}).get('message', res.text)
            if "Limit 12000" in err_msg or "rate_limit" in err_msg.lower() or "too large" in err_msg.lower():
                raise Exception("您上傳的檔案文字量太大啦！超過了 API 的單次處理上限。請嘗試「刪除不需要的頁面」後再上傳！")
            raise Exception(f"Groq API 錯誤: {err_msg}")
            
        raw_content = res.json()['choices'][0]['message']['content']
        
        parsed = []
        starts = [m.start() for m in re.finditer(r'\{\s*"(q|question|題目)"\s*:', raw_content)]
        
        for start in starts:
            depth = 0
            for i in range(start, len(raw_content)):
                if raw_content[i] == '{':
                    depth += 1
                elif raw_content[i] == '}':
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(raw_content[start:i+1])
                            if "options" in obj and "ans" in obj:
                                parsed.append(obj)
                        except:
                            pass
                        break
                        
        if not parsed:
            raise Exception("AI 沒有成功生成任何完整的題目，請嘗試減少檔案內容或重試一次。")
        
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
            
            q_text = str(x.get('q', x.get('question', x.get('題目', '無題目'))))
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
