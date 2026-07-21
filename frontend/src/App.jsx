import React, { useState, useEffect } from 'react';

const API_BASE = "https://sop-quiz-api.onrender.com"; 

// 🌟 圖片自動壓縮技術 (避免圖片太大塞爆資料庫)
const compressImage = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 500; // 最大寬度 500 像素
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // 壓縮為 70% 畫質的 JPEG
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
};

function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.pathname === '/admin');
  const [isAuthenticatedAdmin, setIsAuthenticatedAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [view, setView] = useState('login'); 
  const [user, setUser] = useState({ name: '', emp_id: '' });
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(600);
  const [selectedCategory, setSelectedCategory] = useState('全部');

  useEffect(() => {
    document.title = isAdmin ? "考核系統後端" : "再睡5分鐘考核系統";
  }, [isAdmin]);

  const startQuiz = async () => {
    if (!user.name || !user.emp_id) return alert("請填寫姓名與工號");
    const chineseRegex = /^[\u4E00-\u9FA5]+$/;
    if (!chineseRegex.test(user.name)) return alert("姓名請輸入繁體中文！");

    try {
      const ts = new Date().getTime(); 
      const res = await fetch(`${API_BASE}/get-questions?emp_id=${user.emp_id}&category=${selectedCategory}&t=${ts}`);
      if (res.status === 403) return alert(`此工號已完成【${selectedCategory}】項目考核！`);
      if (!res.ok) {
        const err = await res.json();
        return alert(err.detail || "題庫尚未發布，請洽店長");
      }
      const data = await res.json();
      
      if (!data || data.length === 0) {
        return alert(`⚠️ 目前【${selectedCategory}】分類下還沒有任何題目喔！\n請聯絡店長前往後台發布題目後再進行測驗。`);
      }

      setQuestions(data);
      setTimeLeft(600); 
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
        body: JSON.stringify({ 
          user_name: user.name, 
          emp_id: user.emp_id, 
          score: finalScore, 
          category: selectedCategory, 
          detail: detail 
        })
      });
    } catch (e) {
      alert("⚠️ 網路不穩或伺服器休眠，成績未能上傳成功！\n但您仍可查看分數，請截圖結果給店長紀錄。");
    } finally {
      setView('result'); 
    }
  };

  if (isAdmin) {
    if (!isAuthenticatedAdmin) {
      return (
        <div style={{ padding: '20px', maxWidth: '400px', margin: 'auto', fontFamily: 'sans-serif', textAlign: 'center', marginTop: '100px' }}>
          <div style={{ border: '2px solid #2c3e50', padding: '40px', borderRadius: '20px', backgroundColor: '#fff', boxShadow: '0 4px 10px rgba(0,0,0,0.1)' }}>
            <h2 style={{ color: '#2c3e50', marginBottom: '20px' }}>🔒 店長後台登入</h2>
            <input 
              type="password" 
              placeholder="請輸入店長密碼" 
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (adminPassword === '55555') setIsAuthenticatedAdmin(true);
                  else alert("密碼錯誤！請重新輸入。");
                }
              }}
              style={{...inputStyle, textAlign: 'center', letterSpacing: '5px', fontSize: '18px'}} 
            />
            <button 
              onClick={() => {
                if (adminPassword === '55555') setIsAuthenticatedAdmin(true);
                else alert("密碼錯誤！請重新輸入。");
              }} 
              style={{ ...btnStyle, width: '100%', marginTop: '20px', backgroundColor: '#2c3e50' }}
            >
              進入管理系統
            </button>
          </div>
        </div>
      );
    }
    return <AdminPanel />;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto', fontFamily: 'sans-serif' }}>
      {view === 'login' && (
        <div style={{ textAlign: 'center', border: '2px solid #3498db', padding: '40px', borderRadius: '20px' }}>
          <h2 style={{ color: '#2c3e50' }}>再睡5分鐘考核系統</h2>
          <input placeholder="您的姓名 (中文)" onChange={e => setUser({...user, name: e.target.value.trim()})} style={inputStyle} /><br/>
          <input placeholder="員工工號" onChange={e => setUser({...user, emp_id: e.target.value.trim()})} style={inputStyle} /><br/>
          
          <div style={{ textAlign: 'left', margin: '15px 0' }}>
            <label style={{ fontWeight: 'bold', color: '#34495e', display: 'block', marginBottom: '8px' }}>✍️ 選擇考核項目：</label>
            <select 
              value={selectedCategory} 
              onChange={e => setSelectedCategory(e.target.value)}
              style={{ ...inputStyle, padding: '10px', margin: 0, border: '2px solid #3498db' }}
            >
              <option value="全部">全部 (混和隨機)</option>
              <option value="三崗位">三崗位</option>
              <option value="衛檢流程">衛檢流程</option>
              <option value="新品操作與話術">新品操作與話術</option>
              <option value="前台">前台</option>
              <option value="吧檯">吧檯</option>
              <option value="廚房">廚房</option>
            </select>
          </div>

          <button onClick={startQuiz} style={btnStyle}>開始測驗 (隨機 20 題)</button>
        </div>
      )}
      {view === 'quiz' && (
        <div>
          <div style={{ position: 'sticky', top: 0, backgroundColor: '#fff', padding: '15px 0', borderBottom: '2px solid #3498db', zIndex: 100, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: 0 }}>✍️ 考核中 ({selectedCategory})</h3>
              <small style={{ color: '#7f8c8d' }}>共 {questions.length} 題</small>
            </div>
            <h3 style={{ margin: 0, color: timeLeft <= 60 ? '#e74c3c' : '#27ae60' }}>
              ⏳ 剩餘：{formatTime(timeLeft)}
            </h3>
          </div>

          {questions.map((q, idx) => (
            <div key={idx} style={qBoxStyle}>
              <p><b>{idx + 1}. {q.q}</b></p>
              
              {/* 🌟 考試介面顯示圖片 */}
              {q.image && (
                <div style={{ textAlign: 'center', margin: '15px 0' }}>
                  <img src={q.image} alt="題目配圖" style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '10px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)' }} />
                </div>
              )}

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
          <h2 style={{ color: '#7f8c8d' }}>測驗完成！【{selectedCategory}】分數為：</h2>
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

  const [editingFinalId, setEditingFinalId] = useState(null);
  const [editingFinalData, setEditingFinalData] = useState(null);

  const [onlineFilter, setOnlineFilter] = useState('全部');
  const [draftFilter, setDraftFilter] = useState('全部');

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
        alert("✅ 題目已成功加入草稿！畫面將為您移動至下方檢查並手動分類。");
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
    // 🌟 新增空白題目時預設給予 image 欄位
    const blank = { id: newId, q: "請輸入題目內容", options: { A: "", B: "", C: "", D: "" }, ans: "A", category: "未分類", image: "" };
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
          ans: q.ans || "A",
          category: q.category || "未分類",
          image: q.image || "" // 🌟 匯入時保留圖片
        }));

        const newDraft = [...tempQs, ...formattedData];
        setTempQs(newDraft);
        
        await fetch(`${API_BASE}/admin/save-temp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDraft)
        });
        alert(`✅ 成功匯入 ${formattedData.length} 題並儲存至草稿！`);
        scrollToDraft(); 
      } catch (err) {
        alert("❌ 匯入失敗：檔案不是正確的題庫格式 (JSON)。");
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
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

  const publish = async () => {
    if (tempQs.length === 0) {
      return alert("⚠️ 錯誤：草稿區目前是空的！");
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
    if (!window.confirm("⚠️ 警告：確定要清空線上題庫嗎？")) return;
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

  const exportRecordsToCSV = () => {
    if (records.length === 0) return alert("目前沒有任何成績可以匯出喔！");

    const headers = ["工號", "姓名", "考核項目", "分數", "作答詳情摘要"]; 
    const csvRows = records.map(r => {
      const detailStr = r.detail.map(d => `[${d.isCorrect ? 'O' : 'X'}] ${d.q} (答:${d.userAns})`).join(" | ");
      return [
        `"${r.emp_id}"`,
        `"${r.name}"`,
        `"${r.category}"`,
        `"${r.score}"`,
        `"${detailStr.replace(/"/g, '""')}"`
      ].join(",");
    });

    const csvContent = "\uFEFF" + headers.join(",") + "\n" + csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
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
    if (!window.confirm("⚠️ 確定要從線上題庫刪除這題嗎？")) return;
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

  const filteredFinalQs = finalQs.filter(q => onlineFilter === '全部' || (q.category || '未分類') === onlineFilter);
  const filteredTempQs = tempQs.filter(q => draftFilter === '全部' || (q.category || '未分類') === draftFilter);

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
              <h4 style={{ margin: 0, color: '#27ae60' }}>💡 目前線上題庫 ({finalQs.length} 題)</h4>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold' }}>篩選：</span>
                <select value={onlineFilter} onChange={e => setOnlineFilter(e.target.value)} style={{ padding: '4px', borderRadius: '5px' }}>
                  <option value="全部">全部</option>
                  <option value="三崗位">三崗位</option>
                  <option value="衛檢流程">衛檢流程</option>
                  <option value="新品操作與話術">新品操作與話術</option>
                  <option value="未分類">未分類</option>
                  <option value="前台">前台</option>
                  <option value="吧檯">吧檯</option>
                  <option value="廚房">廚房</option>
                </select>
              </div>

              <button onClick={clearFinal} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c' }}>🚫 清空線上</button>
            </div>
            
            <div style={{ height: '250px', overflowY: 'auto', fontSize: '13px' }}>
              {filteredFinalQs && filteredFinalQs.length > 0 ? (
                filteredFinalQs.map((q, i) => (
                  <div key={q.id} style={{ padding: '10px 5px', borderBottom: '1px solid #f1f1f1' }}>
                    {editingFinalId === q.id ? (
                      <div style={{ padding: '10px', backgroundColor: '#e8f4f8', borderRadius: '8px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#2980b9', display: 'flex', justifyContent: 'space-between' }}>
                          <span>✏️ 修改線上題目：</span>
                          <div>
                            <span style={{ fontSize: '13px' }}>分類：</span>
                            <select 
                              value={editingFinalData.category || "未分類"} 
                              onChange={(e) => setEditingFinalData({ ...editingFinalData, category: e.target.value })}
                              style={{ padding: '2px', borderRadius: '4px' }}
                            >
                              <option value="三崗位">三崗位</option>
                              <option value="衛檢流程">衛檢流程</option>
                              <option value="新品操作與話術">新品操作與話術</option>
                              <option value="未分類">未分類</option>
                              <option value="前台">前台</option>
                              <option value="吧檯">吧檯</option>
                              <option value="廚房">廚房</option>
                            </select>
                          </div>
                        </div>
                        <textarea 
                          value={editingFinalData.q} 
                          onChange={(e) => setEditingFinalData({ ...editingFinalData, q: e.target.value })} 
                          style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                        />
                        
                        {/* 🌟 線上編輯區：圖片上傳與預覽 */}
                        <div style={{ marginBottom: '10px', padding: '10px', border: '1px dashed #bdc3c7', borderRadius: '5px', backgroundColor: '#fff' }}>
                          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#7f8c8d', marginBottom: '5px' }}>🖼️ 題目配圖 (選填)</div>
                          {editingFinalData.image && <img src={editingFinalData.image} alt="預覽" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '5px', marginBottom: '10px' }} />}
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <label style={{ cursor: 'pointer', color: '#3498db', fontSize: '13px', fontWeight: 'bold' }}>
                              [上傳/更換圖片]
                              <input type="file" accept="image/*" hidden onChange={async (e) => {
                                if(e.target.files[0]) {
                                  const base64 = await compressImage(e.target.files[0]);
                                  setEditingFinalData({ ...editingFinalData, image: base64 });
                                }
                              }} />
                            </label>
                            {editingFinalData.image && (
                              <button onClick={() => setEditingFinalData({ ...editingFinalData, image: "" })} style={{ ...miniBtnStyle, padding: '2px 5px', color: '#e74c3c', borderColor: '#e74c3c', fontSize: '12px' }}>
                                ❌ 移除圖片
                              </button>
                            )}
                          </div>
                        </div>

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
                          <span style={{ fontWeight: 'bold', color: '#34495e' }}>{q.id}.</span> 
                          <span style={{ backgroundColor: '#e2f0d9', color: '#27ae60', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', marginRight: '5px', fontWeight: 'bold' }}>
                            {q.category || "未分類"}
                          </span>
                          {q.image && <span style={{ color: '#3498db', fontSize: '12px', marginRight: '5px' }}>[🖼️圖]</span>}
                          {q.q}
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
                <p style={{ color: '#7f8c8d', fontStyle: 'italic', padding: '10px 0' }}>目前篩選條件下沒有題目喔！</p>
              )}
            </div>
          </div>

          <div id="draft-section">
            {tempQs.length > 0 && (
              <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0 }}>🆕 準備發布的草稿 ({tempQs.length} 題)</h4>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>篩選：</span>
                    <select value={draftFilter} onChange={e => setDraftFilter(e.target.value)} style={{ padding: '4px', borderRadius: '5px' }}>
                      <option value="全部">全部</option>
                      <option value="三崗位">三崗位</option>
                      <option value="衛檢流程">衛檢流程</option>
                      <option value="新品操作與話術">新品操作與話術</option>
                      <option value="未分類">未分類</option>
                      <option value="前台">前台</option>
                      <option value="吧檯">吧檯</option>
                      <option value="廚房">廚房</option>
                    </select>
                  </div>
                </div>
                
                <div style={{ height: '400px', overflowY: 'auto', backgroundColor: '#fff', padding: '15px', marginBottom: '10px' }}>
                  {filteredTempQs.map((q) => (
                    <div key={q.id} style={{ borderBottom: '2px solid #ddd', paddingBottom: '15px', marginBottom: '15px' }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>第 {q.id} 題</span>
                        
                        <div>
                          <span style={{ fontSize: '13px', color: '#2c3e50' }}>考核分類：</span>
                          <select 
                            value={q.category || "未分類"} 
                            onChange={(e) => updateDraft(q.id, 'category', e.target.value)}
                            style={{ padding: '4px', borderRadius: '4px', border: '1px solid #bdc3c7' }}
                          >
                            <option value="三崗位">三崗位</option>
                            <option value="衛檢流程">衛檢流程</option>
                            <option value="新品操作與話術">新品操作與話術</option>
                            <option value="未分類">未分類</option>
                            <option value="前台">前台</option>
                            <option value="吧檯">吧檯</option>
                            <option value="廚房">廚房</option>
                          </select>
                        </div>
                      </div>
                      <textarea 
                        value={q.q} 
                        onChange={(e) => updateDraft(q.id, 'q', e.target.value)} 
                        style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                      />

                      {/* 🌟 草稿區：圖片上傳與預覽 */}
                      <div style={{ marginBottom: '10px', padding: '10px', border: '1px dashed #bdc3c7', borderRadius: '5px', backgroundColor: '#fdfdfd' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#7f8c8d', marginBottom: '5px' }}>🖼️ 題目配圖 (選填)</div>
                        {q.image && <img src={q.image} alt="預覽" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '5px', marginBottom: '10px' }} />}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <label style={{ cursor: 'pointer', color: '#3498db', fontSize: '13px', fontWeight: 'bold' }}>
                            [上傳/更換圖片]
                            <input type="file" accept="image/*" hidden onChange={async (e) => {
                              if(e.target.files[0]) {
                                const base64 = await compressImage(e.target.files[0]);
                                updateDraft(q.id, 'image', base64);
                              }
                            }} />
                          </label>
                          {q.image && (
                            <button onClick={() => updateDraft(q.id, 'image', "")} style={{ ...miniBtnStyle, padding: '2px 5px', color: '#e74c3c', borderColor: '#e74c3c', fontSize: '12px' }}>
                              ❌ 移除圖片
                            </button>
                          )}
                        </div>
                      </div>

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
                  {filteredTempQs.length === 0 && (
                    <p style={{ color: '#7f8c8d', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>此篩選分類下目前沒有草稿題目。</p>
                  )}
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
            <div>
              <button onClick={exportRecordsToCSV} style={{ ...miniBtnStyle, color: '#16a085', borderColor: '#16a085', marginRight: '10px' }}>📥 匯出 CSV</button>
              <button onClick={clearRecords} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c' }}>🗑️ 清空成績</button>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#ecf0f1' }}>
                <th style={thStyle}>姓名</th><th style={thStyle}>考核項目</th><th style={thStyle}>分數</th><th style={thStyle}>作答詳情</th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={`${r.emp_id}_${r.category}`} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdStyle}>
                    <span style={{ backgroundColor: '#e8f4f8', color: '#2980b9', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                      {r.category || "全部"}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: r.score >= 80 ? '#27ae60' : '#e74c3c', fontWeight: 'bold' }}>{r.score}</td>
                  <td style={tdStyle}><button onClick={() => setShowDetail(r)} style={miniBtnStyle}>👀 查看</button></td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '20px', color: '#7f8c8d' }}>目前還沒有夥伴完成測驗喔！</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showDetail && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3>夥伴 {showDetail.name} 的作答報告 ({showDetail.category})</h3>
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
