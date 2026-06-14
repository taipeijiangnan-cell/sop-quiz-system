from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import json, io, pypdf, docx, requests, re, os, random
import psycopg2 
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
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

def get_db():
    if not DATABASE_URL:
        raise Exception("遺失 DATABASE_URL 環境變數！請到 Render 後台設定。")
    return psycopg2.connect(DATABASE_URL, sslmode='require')

def init_db():
    if not DATABASE_URL:
        print("尚未設定 DATABASE_URL，等待設定...")
        return
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS temp_qs (id INTEGER PRIMARY KEY, data TEXT)")
        cursor.execute("CREATE TABLE IF NOT EXISTS final_qs (id INTEGER PRIMARY KEY, data TEXT)")
        
        try:
            cursor.execute("SELECT category FROM records LIMIT 1")
        except:
            cursor.execute("DROP TABLE IF EXISTS records")
            
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS records (
                emp_id TEXT, 
                name TEXT, 
                score INTEGER, 
                category TEXT, 
                detail TEXT,
                PRIMARY KEY (emp_id, category)
            )
        """)
        conn.commit()
        conn.close()
        print("✅ 雲端資料庫連線與初始化成功！")
    except Exception as e:
        print(f"資料庫初始化失敗: {e}")

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
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT data FROM temp_qs WHERE id=1")
        old = cursor.fetchone()
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
                "ans": str(x.get('ans', 'A')).upper(),
                "category": "未分類",
                "image": "" # 🌟 確保新增圖片儲存欄位
            })
        
        combined = existing + new_qs
        cursor.execute(
            "INSERT INTO temp_qs (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", 
            (json.dumps(combined),)
        )
        conn.commit(); conn.close()
        return {"status": "ok", "count": len(combined)}
    except Exception as e: 
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/admin/temp-clear")
async def clear_temp():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM temp_qs")
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.post("/admin/save-temp")
async def save_temp(data: List[dict]):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO temp_qs (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", 
            (json.dumps(data),)
        )
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-questions")
async def get_qs(emp_id: str, category: str = "全部"):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT score FROM records WHERE emp_id=%s AND category=%s", (emp_id, category))
    if cursor.fetchone():
        conn.close(); raise HTTPException(status_code=403, detail="此工號已完成此項目考核")
        
    cursor.execute("SELECT data FROM final_qs WHERE id=1")
    data = cursor.fetchone()
    conn.close()
    if not data: raise HTTPException(status_code=400, detail="題庫未就緒")
    
    all_qs = json.loads(data[0])
    
    if category != "全部":
        filtered_qs = [q for q in all_qs if q.get("category", "未分類") == category]
    else:
        filtered_qs = all_qs
        
    if not filtered_qs:
        raise HTTPException(status_code=400, detail=f"目前線上還沒有【{category}】分類的題目喔！")
        
    return random.sample(filtered_qs, min(20, len(filtered_qs)))

@app.post("/submit")
async def submit(data: dict):
    try:
        name = data.get("user_name", "未知姓名")
        emp_id = data.get("emp_id", "未知工號")
        score = data.get("score", 0)
        category = data.get("category", "全部") 
        detail = data.get("detail", [])
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO records (emp_id, name, score, category, detail) 
               VALUES (%s, %s, %s, %s, %s) 
               ON CONFLICT (emp_id, category) 
               DO UPDATE SET name = EXCLUDED.name, score = EXCLUDED.score, detail = EXCLUDED.detail""", 
            (emp_id, name, score, category, json.dumps(detail))
        )
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        print(f"Submit error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/admin/current-final")
async def get_final():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM final_qs WHERE id=1")
    data = cursor.fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.get("/admin/temp-questions")
async def get_temp():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT data FROM temp_qs WHERE id=1")
    data = cursor.fetchone()
    conn.close()
    return json.loads(data[0]) if data else []

@app.post("/admin/publish-questions")
async def publish(data: List[dict]):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM final_qs")
        cursor.execute("INSERT INTO final_qs (id, data) VALUES (1, %s)", (json.dumps(data),))
        conn.commit(); conn.close()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/admin/records")
async def get_recs():
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT emp_id, name, score, category, detail FROM records") 
        recs = cursor.fetchall()
        conn.close()
        result = []
        for r in recs:
            try: det = json.loads(r[4]) if r[4] else []
            except: det = []
            result.append({"emp_id": r[0], "name": r[1], "score": r[2], "category": r[3] or "全部", "detail": det})
        return result
    except: return []

@app.delete("/admin/records/clear")
async def clear_recs():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM records")
    conn.commit(); conn.close()
    return {"status": "ok"}
