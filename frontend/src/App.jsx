import React, { useState, useEffect } from 'react';

const API_BASE = "https://sop-quiz-api.onrender.com"; 

function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.pathname === '/admin');
  const [view, setView] = useState('login'); 
  const [user, setUser] = useState({ name: '', emp_id: '' });
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(600); // 🌟 預設時間改為 600 秒 (10分鐘)

  useEffect(() => {
    document.title = isAdmin ? "考核系統後端" : "再睡五分鐘考核系統";
  }, [isAdmin]);

  const startQuiz = async () => {
    if (!user.name || !user.emp_id) return alert("請填寫姓名與工號");
    // 嚴格中文姓名驗證
    const chineseRegex = /^[\u4E00-\u9FA5]+$/;
    if (!chineseRegex.test(user.name)) return alert("姓名請輸入繁體中文！");

    try {
      const ts = new Date().getTime(); // 破除快取
      const res = await fetch(`${API_BASE}/get-questions?emp_id=${user.emp_id}&t=${ts}`);
      if (res.status === 403) return alert("此工號已完成考核！");
      if (!res.ok) return alert("題庫尚未發布，請洽店長");
      const data = await res.json();
      
      // 🌟 新增防呆：如果線上題庫是 0 題，嚴格擋住不給考！
      if (!data || data.length === 0) {
        return alert("⚠️ 目前線上還沒有任何題目喔！\n請聯絡店長前往後台「正式發布」題庫後再進行測驗。");
      }

      setQuestions(data);
      setTimeLeft(600); // 🌟 每次開始測驗重置的時間改為 600 秒 (10分鐘)
      setView('quiz');
    } catch (e) { alert("系統連線失敗，請檢查網路。"); }
  };

  useEffect(() => {
    if (view !== 'quiz') return;
    if (timeLeft <= 0) {
      alert("⏳ 考試時間到！系統將自動為您交卷。");
      submitQuiz(); 
      return;
    }
    const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    return () => clearTimeout(timer);
  }, [view, timeLeft]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const submitQuiz = async () => {
    let correctCount = 0;
    const detail = questions.map(q => {
      const isCorrect = answers[q.id] === q.ans;
      if (isCorrect) correctCount++;
      return { q: q.q, userAns: answers[q.id] || "未答", correctAns: q.ans, isCorrect };
    });
    const finalScore = Math.round((correctCount / questions.length) * 100);
    setScore(finalScore);
    
    try {
      await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_name: user.name, emp_id: user.emp_id, score: finalScore, detail: detail })
      });
    } catch (e) {
      alert("⚠️ 網路不穩或伺服器休眠，成績未能上傳成功！\n但您仍可查看本次測驗分數，請截圖結果給店長紀錄。");
    } finally {
      setView('result'); 
    }
  };

  if (isAdmin) return <AdminPanel />;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto', fontFamily: 'sans-serif' }}>
      {view === 'login' && (
        <div style={{ textAlign: 'center', border: '2px solid #3498db', padding: '40px', borderRadius: '20px' }}>
          <h2 style={{ color: '#2c3e50' }}>再睡五分鐘考核系統</h2>
          <input placeholder="您的姓名 (中文)" onChange={e => setUser({...user, name: e.target.value.trim()})} style={inputStyle} /><br/>
          <input placeholder="員工工號" onChange={e => setUser({...user, emp_id: e.target.value.trim()})} style={inputStyle} /><br/>
          <button onClick={startQuiz} style={btnStyle}>開始測驗 (隨機 20 題)</button>
        </div>
      )}
      {view === 'quiz' && (
        <div>
          <div style={{ position: 'sticky', top: 0, backgroundColor: '#fff', padding: '15px 0', borderBottom: '2px solid #3498db', zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>✍️ 測驗中 (共 {questions.length} 題)</h3>
            <h3 style={{ margin: 0, color: timeLeft <= 60 ? '#e74c3c' : '#27ae60' }}>
              ⏳ 剩餘：{formatTime(timeLeft)}
            </h3>
          </div>

          {questions.map((q, idx) => (
            <div key={idx} style={qBoxStyle}>
              <p><b>{idx + 1}. {q.q}</b></p>
              {Object.entries(q.options).map(([key, val]) => (
                <label key={key} style={{ display: 'block', margin: '8px 0', cursor: 'pointer' }}>
                  <input type="radio" name={`q${q.id}`} onChange={() => setAnswers({...answers, [q.id]: key})} /> {key}. {val}
                </label>
              ))}
            </div>
          ))}
          <button onClick={submitQuiz} style={{ ...btnStyle, width: '100%' }}>確認交卷</button>
        </div>
      )}
      {view === 'result' && (
        <div style={{ textAlign: 'center', marginTop: '50px' }}>
          <h2 style={{ color: '#7f8c8d' }}>測驗完成！您的分數為：</h2>
          <h1 style={{ fontSize: '80px', color: score >= 80 ? '#27ae60' : '#e74c3c' }}>{score}</h1>
          <p style={{ fontSize: '20px' }}>{score >= 80 ? "✅ 恭喜及格！" : "❌ 未達 80 分及格標準"}</p>
          <button onClick={() => window.location.reload()} style={{ ...btnStyle, marginTop: '20px' }}>回到首頁</button>
        </div>
      )}
    </div>
  );
}

function AdminPanel() {
  const [tempQs, setTempQs] = useState([]);
  const [finalQs, setFinalQs] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false); 

  // 🌟 線上題庫編輯專用狀態
  const [editingFinalId, setEditingFinalId] = useState(null);
  const [editingFinalData, setEditingFinalData] = useState(null);

  const fetchData = async (showToast = false) => {
    try {
      if(showToast) setIsRefreshing(true);
      const ts = new Date().getTime();
      const [tRes, fRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/admin/temp-questions?t=${ts}`),
        fetch(`${API_BASE}/admin/current-final?t=${ts}`),
        fetch(`${API_BASE}/admin/records?t=${ts}`)
      ]);
      setTempQs(await tRes.json() || []);
      setFinalQs(await fRes.json() || []);
      setRecords(await rRes.json() || []);
      
      if(showToast) {
        setTimeout(() => setIsRefreshing(false), 800); 
      }
    } catch (e) { 
      console.error("資料載入失敗"); 
      setIsRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const scrollToDraft = () => {
    setTimeout(() => {
      const draftArea = document.getElementById("draft-section");
      if(draftArea) draftArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 500);
  };

  const handleUpload = async (e) => {
    setLoading(true);
    const formData = new FormData();
    for (let f of e.target.files) formData.append('files', f);
    try {
      const res = await fetch(`${API_BASE}/generate-quiz`, { method: 'POST', body: formData });
      if (res.ok) {
        alert("✅ 題目已成功加入草稿！畫面將為您移動至下方檢查。");
        fetchData();
        scrollToDraft(); 
      } else {
        alert("❌ 生成失敗，可能是檔案格式不符，請再試一次。");
      }
    } catch (e) { alert("連線超時，請檢查網路。"); }
    setLoading(false);
    e.target.value = null;
  };

  const addBlankQuestion = () => {
    const newId = tempQs.length > 0 ? Math.max(...tempQs.map(q => q.id)) + 1 : 1;
    const blank = { id: newId, q: "請輸入題目內容", options: { A: "", B: "", C: "", D: "" }, ans: "A" };
    setTempQs([...tempQs, blank]);
    scrollToDraft(); 
  };

  const saveTemp = async () => {
    await fetch(`${API_BASE}/admin/save-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("草稿儲存成功！");
  };

  const exportDraftToJson = () => {
    if (tempQs.length === 0) return alert("目前沒有草稿可以匯出喔！");
    const blob = new Blob([JSON.stringify(tempQs, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "題庫草稿_備份.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const importDraftFromJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!Array.isArray(importedData)) throw new Error("格式不符");
        
        const currentMaxId = tempQs.length > 0 ? Math.max(...tempQs.map(q => q.id)) : 0;
        const formattedData = importedData.map((q, idx) => ({
          id: currentMaxId + idx + 1,
          q: q.q || "未命名題目",
          options: {
            A: q.options?.A || "",
            B: q.options?.B || "",
            C: q.options?.C || "",
            D: q.options?.D || ""
          },
          ans: q.ans || "A"
        }));

        const newDraft = [...tempQs, ...formattedData];
        setTempQs(newDraft);
        
        await fetch(`${API_BASE}/admin/save-temp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDraft)
        });
        alert(`✅ 成功匯入 ${formattedData.length} 題並儲存至草稿！\n畫面將為您移動至下方檢查。`);
        scrollToDraft(); 
      } catch (err) {
        alert("❌ 匯入失敗：檔案不是正確的題庫格式 (JSON)。");
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  const publish = async () => {
    if (tempQs.length === 0) {
      return alert("⚠️ 錯誤：草稿區目前是空的！\n請先上傳 SOP 或是匯入 JSON 後，再按正式發布。");
    }
    if (!window.confirm(`確定發布這 ${tempQs.length} 題嗎？這將覆蓋目前的線上題庫。`)) return;
    
    try {
      const res = await fetch(`${API_BASE}/admin/publish-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempQs)
      });
      if (!res.ok) throw new Error("儲存失敗");
      alert("🚀 發布成功！夥伴現在可以使用新題庫測驗了。");
      fetchData(); 
    } catch (error) {
      alert(`❌ 發布失敗！請檢查網路。`);
    }
  };

  const clearFinal = async () => {
    if (finalQs.length === 0) return alert("目前沒有發布的題庫！");
    if (!window.confirm("⚠️ 警告：確定要清空線上題庫嗎？清空後夥伴將無法進行測驗！")) return;
    try {
      await fetch(`${API_BASE}/admin/publish-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]) 
      });
      alert("線上題庫已成功清空！");
      fetchData();
    } catch (error) { alert(`❌ 清空失敗！`); }
  };

  const clearTemp = async () => {
    if (window.confirm("確定要清空草稿嗎？")) {
      await fetch(`${API_BASE}/admin/temp-clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  const clearRecords = async () => {
    if (window.confirm("確定要清空所有成績紀錄嗎？(無法復原)")) {
      await fetch(`${API_BASE}/admin/records/clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  // 🌟 新增：成績匯出成 CSV 功能
  const exportRecordsToCSV = () => {
    if (records.length === 0) return alert("目前沒有任何成績可以匯出喔！");

    // 設定欄位標題
    const headers = ["工號", "姓名", "分數", "作答詳情摘要"];

    // 處理每一筆資料
    const csvRows = records.map(r => {
      // 提取作答詳情： [O] 題目... 或 [X] 題目...
      const detailStr = r.detail.map(d => `[${d.isCorrect ? 'O' : 'X'}] ${d.q} (答:${d.userAns})`).join(" | ");
      
      // 用雙引號包覆欄位，避免內部有逗號或換行破壞 CSV 格式
      return [
        `"${r.emp_id}"`,
        `"${r.name}"`,
        `"${r.score}"`,
        `"${detailStr.replace(/"/g, '""')}"`
      ].join(",");
    });

    // 組合文字，前面加上 \uFEFF 是為了讓 Excel 開啟時認得 UTF-8 中文編碼，避免亂碼
    const csvContent = "\uFEFF" + headers.join(",") + "\n" + csvRows.join("\n");

    // 觸發下載
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    // 檔名加上今天的日期
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `夥伴考核成績_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateDraft = (id, field, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, [field]: value } : q));
  };
  const updateOption = (id, optKey, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, options: { ...q.options, [optKey]: value } } : q));
  };

  const startEditingFinal = (q) => {
    setEditingFinalId(q.id);
    setEditingFinalData(JSON.parse(JSON.stringify(q)));
  };

  const saveEditingFinal = async () => {
    const newFinalQs = finalQs.map(q => q.id === editingFinalId ? editingFinalData : q);
    try {
      const res = await fetch(`${API_BASE}/admin/publish-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFinalQs)
      });
      if (!res.ok) throw new Error("儲存失敗");
      setFinalQs(newFinalQs);
      setEditingFinalId(null);
      setEditingFinalData(null);
    } catch (e) {
      alert("修改失敗，請檢查網路連線。");
    }
  };

  const deleteFinalQuestion = async (id) => {
    if (!window.confirm("⚠️ 確定要從線上題庫刪除這題嗎？\n(夥伴將立刻考不到這題)")) return;
    const newFinalQs = finalQs.filter(q => q.id !== id);
    try {
      await fetch(`${API_BASE}/admin/publish-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFinalQs)
      });
      setFinalQs(newFinalQs);
    } catch (e) {
      alert("刪除失敗，請檢查網路連線。");
    }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif', backgroundColor: '#f4f7f6', minHeight: '100vh' }}>
      <h1 style={{ color: '#2c3e50', textAlign: 'center' }}>🛡️ 店長後台管理中心</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '30px' }}>
        <div style={cardStyle}>
          <h3>📚 題庫與出題</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '15px' }}>
            <label style={{ ...btnStyle, backgroundColor: '#34495e', margin: 0 }}>
              🤖 AI 自動產題
              <input type="file" multiple hidden onChange={handleUpload} />
            </label>
            <button onClick={addBlankQuestion} style={{ ...btnStyle, backgroundColor: '#9b59b6', margin: 0 }}>➕ 手動新增一題</button>
            <label style={{ ...btnStyle, backgroundColor: '#f39c12', margin: 0, cursor: 'pointer' }}>
              📥 匯入 JSON
              <input type="file" accept=".json" hidden onChange={importDraftFromJson} />
            </label>
            <button onClick={exportDraftToJson} style={{ ...btnStyle, backgroundColor: '#16a085', margin: 0 }}>📤 匯出 JSON</button>
            <button onClick={clearTemp} style={{ ...btnStyle, backgroundColor: '#e74c3c', margin: 0 }}>🗑️ 清空草稿</button>
          </div>
          {loading && <p style={{ color: '#e67e22', fontWeight: 'bold' }}>🚀 AI 正在閱讀並產題中，請稍候...</p>}
          
          <div style={{ marginTop: '20px', border: '2px solid #27ae60', borderRadius: '10px', padding: '15px', backgroundColor: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, color: '#27ae60' }}>💡 目前線上發布的題庫 ({finalQs.length} 題)</h4>
              <button onClick={clearFinal} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c' }}>🚫 清空線上題庫</button>
            </div>
            
            <div style={{ height: '250px', overflowY: 'auto', fontSize: '13px' }}>
              {finalQs && finalQs.length > 0 ? (
                finalQs.map((q, i) => (
                  <div key={q.id} style={{ padding: '10px 5px', borderBottom: '1px solid #f1f1f1' }}>
                    {editingFinalId === q.id ? (
                      <div style={{ padding: '10px', backgroundColor: '#e8f4f8', borderRadius: '8px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#2980b9' }}>✏️ 修改線上題目：</div>
                        <textarea 
                          value={editingFinalData.q} 
                          onChange={(e) => setEditingFinalData({ ...editingFinalData, q: e.target.value })} 
                          style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          {['A', 'B', 'C', 'D'].map(opt => (
                            <div key={opt} style={{ display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '5px', fontWeight: 'bold' }}>{opt}.</span>
                              <input 
                                value={editingFinalData.options[opt] || ""} 
                                onChange={(e) => setEditingFinalData({ ...editingFinalData, options: { ...editingFinalData.options, [opt]: e.target.value } })} 
                                style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                              />
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: '10px', fontWeight: 'bold', color: '#27ae60', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            正確答案：
                            <select 
                              value={editingFinalData.ans} 
                              onChange={(e) => setEditingFinalData({ ...editingFinalData, ans: e.target.value })}
                              style={{ marginLeft: '5px', padding: '5px', borderRadius: '4px' }}
                            >
                              <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
                            </select>
                          </div>
                          <div>
                            <button onClick={saveEditingFinal} style={{ ...miniBtnStyle, backgroundColor: '#27ae60', color: 'white', borderColor: '#27ae60', marginRight: '5px' }}>💾 儲存</button>
                            <button onClick={() => setEditingFinalId(null)} style={{ ...miniBtnStyle, backgroundColor: '#95a5a6', color: 'white', borderColor: '#95a5a6' }}>❌ 取消</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, paddingRight: '10px', lineHeight: '1.4' }}>
                          <span style={{ fontWeight: 'bold', color: '#34495e' }}>{i + 1}.</span> {q.q}
                        </div>
                        <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                          <button onClick={() => startEditingFinal(q)} style={{ ...miniBtnStyle, color: '#f39c12', borderColor: '#f39c12' }}>✏️</button>
                          <button onClick={() => deleteFinalQuestion(q.id)} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c' }}>🗑️</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p style={{ color: '#e74c3c', fontWeight: 'bold' }}>⚠️ 目前線上沒有題庫！夥伴無法測驗！請趕快上傳或匯入題目並按發布。</p>
              )}
            </div>
          </div>

          <div id="draft-section">
            {tempQs.length > 0 && (
              <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '10px' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>🆕 準備發布的草稿 ({tempQs.length} 題) - <span style={{color:'red'}}>可點擊下方文字修改</span></h4>
                
                <div style={{ height: '400px', overflowY: 'auto', backgroundColor: '#fff', padding: '15px', marginBottom: '10px' }}>
                  {tempQs.map((q) => (
                    <div key={q.id} style={{ borderBottom: '2px solid #ddd', paddingBottom: '15px', marginBottom: '15px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>第 {q.id} 題：</div>
                      <textarea 
                        value={q.q} 
                        onChange={(e) => updateDraft(q.id, 'q', e.target.value)} 
                        style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {['A', 'B', 'C', 'D'].map(opt => (
                          <div key={opt} style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ marginRight: '5px' }}>{opt}.</span>
                            <input 
                              value={q.options[opt] || ""} 
                              onChange={(e) => updateOption(q.id, opt, e.target.value)} 
                              style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                            />
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: '10px', fontWeight: 'bold', color: '#27ae60' }}>
                        正確答案：
                        <select 
                          value={q.ans} 
                          onChange={(e) => updateDraft(q.id, 'ans', e.target.value)}
                          style={{ marginLeft: '10px', padding: '5px', borderRadius: '4px' }}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={saveTemp} style={{ ...btnStyle, backgroundColor: '#2980b9', flex: 1, margin: 0 }}>💾 儲存草稿</button>
                  <button onClick={publish} style={{ ...btnStyle, backgroundColor: '#27ae60', flex: 1, margin: 0 }}>🚀 正式發布 (推送到線上)</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>
              📈 夥伴考核成績紀錄 
              <button 
                onClick={() => fetchData(true)} 
                style={{ ...miniBtnStyle, marginLeft: '10px', color: '#3498db', borderColor: '#3498db' }}
              >
                {isRefreshing ? '🔄 刷新中...' : '🔄 刷新成績'}
              </button>
            </h3>
            {/* 🌟 這裡加入了 📥 匯出 CSV 按鈕 */}
            <div>
              <button onClick={exportRecordsToCSV} style={{ ...miniBtnStyle, color: '#16a085', borderColor: '#16a085', marginRight: '10px' }}>📥 匯出 CSV</button>
              <button onClick={clearRecords} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c' }}>🗑️ 清空成績</button>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#ecf0f1' }}>
                <th style={thStyle}>姓名</th><th style={thStyle}>分數</th><th style={thStyle}>作答詳情</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.emp_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={{ ...tdStyle, color: r.score >= 80 ? '#27ae60' : '#e74c3c', fontWeight: 'bold' }}>{r.score}</td>
                  <td style={tdStyle}><button onClick={() => setShowDetail(r)} style={miniBtnStyle}>👀 查看</button></td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan="3" style={{ textAlign: 'center', padding: '20px', color: '#7f8c8d' }}>目前還沒有夥伴完成測驗喔！</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showDetail && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3>夥伴 {showDetail.name} 的作答報告</h3>
            <div style={{ maxHeight: '400px', overflowY: 'auto', textAlign: 'left' }}>
              {showDetail.detail.map((d, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}>
                  <p style={{ margin: '0 0 5px 0' }}><b>Q: {d.q}</b></p>
                  <p style={{ margin: 0, color: d.isCorrect ? '#27ae60' : '#e74c3c' }}>
                    夥伴答: {d.userAns} | 正確答: {d.correctAns} {d.isCorrect ? '✅' : '❌'}
                  </p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowDetail(null)} style={{ ...btnStyle, marginTop: '20px', width: '100%', margin: 0 }}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = { padding: '12px', margin: '10px 0', width: '100%', borderRadius: '8px', border: '1px solid #bdc3c7', boxSizing: 'border-box' };
const btnStyle = { padding: '12px 24px', borderRadius: '8px', border: 'none', backgroundColor: '#3498db', color: 'white', fontWeight: 'bold', cursor: 'pointer', display: 'inline-block' };
const qBoxStyle = { marginBottom: '25px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '12px', borderLeft: '5px solid #3498db' };
const cardStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' };
const thStyle = { padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' };
const tdStyle = { padding: '12px' };
const miniBtnStyle = { padding: '5px 10px', borderRadius: '5px', border: '1px solid #3498db', color: '#3498db', backgroundColor: 'transparent', cursor: 'pointer' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalStyle = { backgroundColor: 'white', padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '600px', textAlign: 'center' };

export default App;
