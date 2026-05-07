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
    
    # 🌟 大師級提示詞：直接教 AI 如何把 SOP 拆解成 20 題，並封殺所有偷懶行為
    system_prompt = """你是一位極度嚴格、專注於細節的「飲料店 SOP 考核出題官」。
    你的任務是將【文件內容】轉化為精準、專業的員工測驗題。請忽略文件中無意義的亂碼（如重複的月月月或標點符號）。

    【🔴 嚴重違規行為（絕對禁止，觸犯視為不及格）】
    1. 禁用偷懶代名詞：題目中【絕對不可以】出現「某產品」、「該物料」、「文件中」這種模糊字眼。必須明確寫出全名（例如：「黑桑莓莓沙沙」、「檸檬凍」、「桑椹藍莓醬」）。
    2. 禁用敷衍選項：選項中【絕對不可以】出現「未指定」、「其他」、「以上皆是」、「以上皆非」。必須給出四個具體的數字或做法（例如：A. 75g, B. 375g, C. 750g, D. 100g）。
    3. 禁止文字與數學遊戲：絕對不准考「出現了幾次」、「體積單位是什麼」、「什麼是倍數」。

    【🟢 出題金鑰：如何從這份 SOP 榨出 20 題？】
    請針對以下 5 個類別來出題，確保題目涵蓋所有細節，完美達成 20 題：
    1. 飲品配方細節（例如：大杯黑桑莓莓沙沙的冰塊要幾克？混合果醬要幾克？檸檬凍要多少克？）
    2. 機器與流程（例如：冰沙機要按幾號？瞬轉要按幾秒？環保杯的重量限制？）
    3. 配料製作過程（例如：煮製一份檸檬凍的細砂糖要幾克？熱水要多少？電磁爐火力設定多少？常溫靜置多久？切塊要切多大？）
    4. 效期與保存（例如：桑椹藍莓醬開封後效期多久？換容器效期多久？冷凍物料退冰效期怎麼算？）
    5. 叫貨與包裝（例如：濃糖桑椹藍莓風味糖漿一箱有幾桶？到貨日怎麼算？）

    【✅ 輸出格式規範】
    必須嚴格以 JSON 物件格式回傳，且包含一個名為 "quiz" 的陣列。
    格式範例：
    {
      "quiz": [
        {
          "q": "根據 SOP，煮製「一份」檸檬凍時，需要加入多少克的細砂糖？",
          "options": {"A": "75g", "B": "375g", "C": "750g", "D": "100g"},
          "ans": "A"
        }
      ]
    }"""

    # 🌟 強制出滿 20 題
    user_prompt = f"請根據以下【文件內容】，嚴格遵守出題金鑰的 5 大分類，設計出「20 題」高品質的繁體中文單選題。請記得：題目中必須明確寫出『產品名稱』，選項必須是具體的數字或內容。\n\n【文件內容開始】\n{all_text[:10000]}\n【文件內容結束】"
    
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
        "temperature": 0.2, # 🌟 給予微幅的溫度(0.2)，讓它有足夠的靈活性去從不同段落挖出 20 題不同的題目
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
