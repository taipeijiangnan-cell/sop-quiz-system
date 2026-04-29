from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import json, io, pypdf, docx, requests, sqlite3, re
from typing import List

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = "AIzaSyCbPteKj2GY1dLBzT9eLgDvFDkspeAhR0g"

def init_db():
    conn = sqlite3.connect("quiz_data.db")
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS temp_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS final_qs (id INTEGER PRIMARY KEY, data TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS records (emp_id TEXT PRIMARY KEY, name TEXT, score INTEGER)")
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
    except Exception as e: 
        print(f"檔案解析錯誤: {e}")
    return text

@app.post("/generate-quiz")
async def generate_quiz(files: List[UploadFile] = File(...)):
    all_text = ""
    for f in files: 
        file_content = await extract_text(f)
        all_text += f"\n\n[File: {f.filename}]\n{file_content}"
    
    prompt = f"""
    你是嚴格的門市考核專家。請針對以下內文設計「剛好 20 題」繁體中文單選題。
    【絕對強制規定】：你必須回傳合法的 JSON 陣列格式。
    不要加任何 Markdown 標記，不要加任何反引號。
    必須包含 "q" (題目), "options" (選項 A, B, C, D), "ans" (答案)。
    範例格式：
    [ {{"q": "題目內容", "options": {{"A":"1","B":"2","C":"3","D":"4"}}, "ans": "A"}} ]
    內文：
    {all_text}
    """
    
    available_models = ["models/gemini-1.5-flash-latest", "models/gemini-1.5-flash", "models/gemini-pro"]
    try:
        list_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"
        r = requests.get(list_url)
        if r.status_code == 200:
            available_models = [m["name"] for m in r.json().get("models", []) if "generateContent" in m["supportedGenerationMethods"]]
    except Exception as e: 
        print(f"獲取模型列表失敗: {e}")

    for model_path in available_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent?key={API_KEY}"
        try:
            print(f"正在嘗試使用模型: {model_path} ...")
            res = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=90)
            
            if res.status_code == 200:
                raw = res.json()['candidates'][0]['content']['parts'][0]['text']
                raw = raw.strip()
                
                json_marker = "`" * 3 + "json"
                code_marker = "`" * 3
                if raw.startswith(json_marker): raw = raw[7:]
                elif raw.startswith(code_marker): raw = raw[3:]
                if raw.endswith(code_marker): raw = raw[:-3]
                raw = raw.strip()
                
                match = re.search(r'\[.*\]', raw, re.DOTALL)
                if match: raw = match.group()
                parsed = json.loads(raw)
                
                if isinstance(parsed, dict):
                    for v in parsed.values():
                        if isinstance(v, list): parsed = v; break
                
                cleaned = []
                for i, item in enumerate(parsed[:20]):
                    q_text = item.get("q") or item.get("question") or "題目載入失敗"
                    opts = item.get("options") or {}
                    cleaned.append({
                        "id": i + 1, "q": str(q_text),
                        "options": {
                            "A": str(opts.get("A") or "選項A"), "B": str(opts.get("B") or "選項B"),
                            "C": str(opts.get("C") or "選項C"), "D": str(opts.get("D") or "選項D")
                        },
                        "ans": str(item.get("ans") or "A").upper()
                    })
                
                while len(cleaned) < 20:
                    cleaned.append({
                        "id": len(cleaned) + 1, 
                        "q": "【系統提示：AI 產生的題目不足，請手動補齊】", 
                        "options": {"A":"輸入選項A","B":"輸入選項B","C":"輸入選項C","D":"輸入選項D"}, 
                        "ans": "A"
                    })

                conn = sqlite3.connect("quiz_data.db")
                conn.execute("DELETE FROM temp_qs")
                conn.execute("INSERT INTO temp_qs (id, data) VALUES (1, ?)", (json.dumps(cleaned),))
                conn.commit(); conn.close()
                print("✅ 考卷生成並儲存成功！")
                return {"status": "ok"}
            else:
                print(f"❌ API 回傳錯誤碼 {res.status_code}: {res.text}")
                continue
        except Exception as e: 
            print(f"❌ 程式處理時發生錯誤: {e}")
            continue
            
    print("🚨 所有模型都嘗試失敗了！")
    raise HTTPException(status_code=500, detail="生成失敗")

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
    conn.execute("INSERT INTO final_qs (id, data) VALUES (1, ?)", (json.dumps(data),))
    conn.commit(); conn.close()
    return {"status": "ok"}

@app.get("/get-questions")
async def get_qs(emp_id: str):
    conn = sqlite3.connect("quiz_data.db")
    if conn.execute("SELECT score FROM records WHERE emp_id=?", (emp_id,)).fetchone():
        conn.close(); raise HTTPException(status_code=403, detail="此工號已考過")
    data = conn.execute("SELECT data FROM final_qs WHERE id=1").fetchone()
    conn.close()
    if not data: raise HTTPException(status_code=400, detail="未發布")
    return [{"id": q["id"], "q": q["q"], "options": q["options"]} for q in json.loads(data[0])]

@app.post("/submit")
async def submit(data: dict):
    name = data.get("user_name")
    emp_id = data.get("emp_id")
    ans = data.get("answers", {})
    conn = sqlite3.connect("quiz_data.db")
    raw = conn.execute("SELECT data FROM final_qs WHERE id=1").fetchone()
    final_qs = json.loads(raw[0])
    score = sum(5 for q in final_qs if str(ans.get(str(q["id"]))) == str(q["ans"]))
    conn.execute("INSERT OR REPLACE INTO records (emp_id, name, score) VALUES (?, ?, ?)", (emp_id, name, score))
    conn.commit(); conn.close()
    return {"score": score}

@app.get("/admin/records")
async def get_recs():
    conn = sqlite3.connect("quiz_data.db")
    recs = conn.execute("SELECT emp_id, name, score FROM records").fetchall()
    conn.close()
    return [{"emp_id": r[0], "name": r[1], "score": r[2]} for r in recs]

@app.delete("/admin/records/{emp_id}")
async def delete_rec(emp_id: str):
    conn = sqlite3.connect("quiz_data.db")
    conn.execute("DELETE FROM records WHERE emp_id=?", (emp_id,))
    conn.commit(); conn.close()
    return {"status": "ok"}
