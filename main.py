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
    
    # 🌟 強化過濾亂碼：移除重複過多的符號或無意義排版字元
    text = re.sub(r'(月|日| ) {3,}', '', text) 
    text = re.sub(r'[\r\n\t]+', '\n', text)
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
        raise HTTPException(status_code=400, detail="無法讀取檔案文字！請確認 PDF 不是純圖片。")
    
    # 🌟 究極嚴格 System Prompt：徹底封印 AI 的外部幻想
    system_prompt = """你是一個完全沒有記憶的「再睡5分鐘」專屬出題機器人。
    【絕對準則 - 違者嚴懲】
    1. 你的世界只有我提供的【參考文件內容】。禁止使用你腦中任何關於飲料店、節日或 SOP 的外部知識。
    2. 禁止幻想！絕對不准發明不存在的節日（如：夏日清涼節）、不存在的產品。
    3. 每個題目和答案都必須在文件中找到「精準對應的字眼」。文件沒寫，你就絕對不准出！
    4. 禁止出抽象題（如：應進行哪些工作？）。必須考具體的活動日期、折扣金額、話術規範或配方克數。
    5. 如果內容不足以出 20 題高品質題目，請透過細分題目（例如同一個活動考日期、考話術、考限制）來達成 20 題，嚴禁編造。

    【✅ 輸出格式】
    直接以 JSON 陣列格式輸出。格式範例：
    [
      { "q": "根據文件，製作『茶泡飯奶蓋』時應跟顧客說什麼話術？", "options": {"A": "歡迎光臨", "B": "愚人節快樂", "C": "請先就口飲用", "D": "以上皆是"}, "ans": "B" }
    ]"""

    # 🌟 字數平衡 (Input: 4500, Output: 3500)，確保不觸發 12000 TPM 限制
    user_prompt = f"請嚴格根據以下【參考文件內容】，設計 20 題具備文件依據的繁體中文單選題。不准幻想！\n\n【參考文件內容開始】\n{all_text[:4500]}\n【參考文件內容結束】\n\n請直接開始輸出 JSON 陣列，第一個字元必須是 [。"
    
    url = "https://api.groq.com/openai/v1/chat/completions"
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
        "temperature": 0.0, # 🌟 降到 0，徹底消滅創造力與幻想
        "max_tokens": 3500, 
    }
    
    try:
        res = requests.post(url, headers=headers, json=payload, timeout=120)
        
        if res.status_code != 200:
            err_msg = res.json().get('error', {}).get('message', res.text)
            if "Limit 12000" in err_msg:
                raise Exception("檔案文字量太大，超過 API 單次限制。請嘗試「清空草稿」並分批次上傳檔案。")
            raise Exception(f"Groq API 錯誤: {err_msg}")
            
        raw_content = res.json()['choices'][0]['message']['content']
        
        # 🌟 磁鐵解析法：強行萃取所有完整題目，無視廢話或斷尾
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
            raise Exception("AI 生成題目失敗，可能是內容太少無法出題，請重試一次。")
        
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
