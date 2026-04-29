import React, { useState, useEffect } from 'react';

// 🌟 確保這裡是你的 Render 網址 (不要有結尾的 /)
const API_BASE = "[https://sop-quiz-api.onrender.com](https://sop-quiz-api.onrender.com)"; 

function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.pathname === '/admin');
  const [view, setView] = useState('login'); 
  const [user, setUser] = useState({ name: '', emp_id: '' });
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [score, setScore] = useState(0);

  const startQuiz = async () => {
    if (!user.name || !user.emp_id) return alert("請填寫姓名與工號");
    try {
      const res = await fetch(`${API_BASE}/get-questions?emp_id=${user.emp_id}`);
      if (res.status === 403) return alert("此工號已完成考核！");
      if (!res.ok) return alert("題庫尚未發布，請洽店長");
      const data = await res.json();
      setQuestions(data);
      setView('quiz');
    } catch (e) { alert("系統連線失敗"); }
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
        body: JSON.stringify({ ...user, score: finalScore, detail: detail })
      });
      setView('result');
    } catch (e) { alert("交卷失敗，請截圖成績畫面"); }
  };

  if (isAdmin) return <AdminPanel />;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto', fontFamily: 'sans-serif' }}>
      {view === 'login' && (
        <div style={{ textAlign: 'center', border: '2px solid #3498db', padding: '40px', borderRadius: '20px' }}>
          <h2 style={{ color: '#2c3e50' }}>🏢 門市 SOP 考核系統</h2>
          <input placeholder="您的姓名" onChange={e => setUser({...user, name: e.target.value})} style={inputStyle} /><br/>
          <input placeholder="員工工號" onChange={e => setUser({...user, emp_id: e.target.value})} style={inputStyle} /><br/>
          <button onClick={startQuiz} style={btnStyle}>開始測驗 (隨機 20 題)</button>
        </div>
      )}
      {view === 'quiz' && (
        <div>
          <h3>✍️ 測驗中 (共 20 題)</h3>
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

  const fetchData = async () => {
    try {
      const [tRes, fRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/admin/temp-questions`),
        fetch(`${API_BASE}/admin/current-final`),
        fetch(`${API_BASE}/admin/records`)
      ]);
      setTempQs(await tRes.json() || []);
      setFinalQs(await fRes.json() || []);
      setRecords(await rRes.json() || []);
    } catch (e) { console.error("資料載入失敗，等待伺服器喚醒中..."); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleUpload = async (e) => {
    setLoading(true);
    const formData = new FormData();
    for (let f of e.target.files) formData.append('files', f);
    try {
      const res = await fetch(`${API_BASE}/generate-quiz`, { method: 'POST', body: formData });
      if (res.ok) {
        alert("✅ 題目已成功加入草稿區！");
        fetchData();
      } else {
        alert("❌ 生成失敗 (500錯誤)，但系統已啟動防呆過濾，請再上傳一次即可。");
      }
    } catch (e) { alert("連線超時，請稍後刷新網頁。"); }
    setLoading(false);
  };

  const clearTemp = async () => {
    if (window.confirm("確定要清空目前的草稿嗎？")) {
      await fetch(`${API_BASE}/admin/temp-clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  const publish = async () => {
    if (tempQs.length === 0) return alert("草稿區沒有題目！");
    if (!window.confirm(`確定將這 ${tempQs.length} 題發布為正式題庫嗎？這將覆蓋舊題庫。`)) return;
    await fetch(`${API_BASE}/admin/publish-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("🚀 發布成功！夥伴現在進來考試會自動抽題。");
    fetchData();
  };

  const clearRecords = async () => {
    if (window.confirm("確定要清空所有成績紀錄嗎？(無法復原)")) {
      await fetch(`${API_BASE}/admin/records/clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  // 🌟 新增：更新草稿區的單一欄位
  const updateDraft = (id, field, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, [field]: value } : q));
  };
  // 🌟 新增：更新草稿區的特定選項 (A, B, C, D)
  const updateOption = (id, optKey, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, options: { ...q.options, [optKey]: value } } : q));
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif', backgroundColor: '#f4f7f6', minHeight: '100vh' }}>
      <h1 style={{ color: '#2c3e50', textAlign: 'center' }}>🛡️ 店長後台管理中心</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '30px' }}>
        {/* 題庫區 */}
        <div style={cardStyle}>
          <h3>📚 題庫與出題</h3>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <label style={{ ...btnStyle, backgroundColor: '#34495e', margin: 0 }}>
              📁 上傳 SOP 產出 20 題
              <input type="file" multiple hidden onChange={handleUpload} />
            </label>
            <button onClick={clearTemp} style={{ ...btnStyle, backgroundColor: '#e74c3c', margin: 0, padding: '12px' }}>🗑️ 清空草稿</button>
          </div>
          {loading && <p style={{ color: '#e67e22', fontWeight: 'bold' }}>🚀 AI 正在閱讀並產題中，請稍候...</p>}
          
          <div style={{ marginTop: '20px', border: '1px solid #bdc3c7', borderRadius: '10px', padding: '15px', backgroundColor: '#fff' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#2c3e50' }}>💡 目前線上發布的題庫 ({finalQs.length} 題)</h4>
            <div style={{ height: '200px', overflowY: 'auto', fontSize: '13px' }}>
              {finalQs.map((q, i) => <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #f1f1f1' }}>{q.id}. {q.q}</div>)}
              {finalQs.length === 0 && <p style={{ color: '#95a5a6' }}>尚未發布題目</p>}
            </div>
          </div>

          {/* 🌟 修改：全新的可編輯草稿區 */}
          {tempQs.length > 0 && (
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', borderRadius: '10px' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>🆕 準備發布的草稿 ({tempQs.length} 題) - <span style={{color: '#d35400'}}>可直接點擊框框修改</span></h4>
              
              <div style={{ height: '400px', overflowY: 'auto', backgroundColor: '#fff', padding: '15px', marginBottom: '10px', borderRadius: '8px' }}>
                {tempQs.map((q) => (
                  <div key={q.id} style={{ borderBottom: '2px solid #ddd', paddingBottom: '15px', marginBottom: '15px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#2c3e50' }}>第 {q.id} 題：</div>
                    
                    {/* 編輯題目 */}
                    <textarea 
                      value={q.q} 
                      onChange={(e) => updateDraft(q.id, 'q', e.target.value)} 
                      style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '5px', border: '1px solid #ccc', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      rows="2"
                    />
                    
                    {/* 編輯選項 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      {['A', 'B', 'C', 'D'].map(opt => (
                        <div key={opt} style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ marginRight: '8px', fontWeight: 'bold' }}>{opt}.</span>
                          <input 
                            value={q.options[opt] || ""} 
                            onChange={(e) => updateOption(q.id, opt, e.target.value)} 
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                          />
                        </div>
                      ))}
                    </div>
                    
                    {/* 編輯正確答案 */}
                    <div style={{ marginTop: '12px', fontWeight: 'bold', color: '#27ae60', display: 'flex', alignItems: 'center' }}>
                      正確答案：
                      <select 
                        value={q.ans} 
                        onChange={(e) => updateDraft(q.id, 'ans', e.target.value)}
                        style={{ marginLeft: '10px', padding: '8px', borderRadius: '4px', border: '1px solid #27ae60', backgroundColor: '#e9f7ef', fontWeight: 'bold' }}
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
              <button onClick={publish} style={{ ...btnStyle, backgroundColor: '#27ae60', width: '100%', margin: 0 }}>✅ 確認內容並正式發布</button>
            </div>
          )}
        </div>

        {/* 成績區 */}
        <div style={cardStyle}>
          <h3>📈 夥伴考核成績紀錄 <button onClick={clearRecords} style={{ ...miniBtnStyle, color: '#e74c3c', borderColor: '#e74c3c', float: 'right' }}>清空成績</button></h3>
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
            </tbody>
          </table>
        </div>
      </div>

      {/* 詳細作答報告彈窗 */}
      {showDetail && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3 style={{ color: '#2c3e50' }}>夥伴 {showDetail.name} 的作答報告</h3>
            <div style={{ maxHeight: '500px', overflowY: 'auto', textAlign: 'left', padding: '10px' }}>
              {showDetail.detail.map((d, i) => (
                <div key={i} style={{ padding: '15px', borderBottom: '1px solid #eee', backgroundColor: d.isCorrect ? '#f9fff9' : '#fff9f9', marginBottom: '10px', borderRadius: '8px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '15px' }}><b>Q: {d.q}</b></p>
                  <p style={{ margin: 0, color: d.isCorrect ? '#27ae60' : '#e74c3c', fontWeight: 'bold' }}>
                    夥伴答: {d.userAns} | 正確答: {d.correctAns} {d.isCorrect ? '✅' : '❌'}
                  </p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowDetail(null)} style={{ ...btnStyle, marginTop: '20px', width: '100%', margin: 0 }}>關閉報告</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 共用樣式
const inputStyle = { padding: '12px', margin: '10px 0', width: '100%', borderRadius: '8px', border: '1px solid #bdc3c7', boxSizing: 'border-box' };
const btnStyle = { padding: '12px 24px', borderRadius: '8px', border: 'none', backgroundColor: '#3498db', color: 'white', fontWeight: 'bold', cursor: 'pointer' };
const qBoxStyle = { marginBottom: '25px', padding: '20px', backgroundColor: '#f9f9f9', borderRadius: '12px', borderLeft: '5px solid #3498db' };
const cardStyle = { backgroundColor: 'white', padding: '25px', borderRadius: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' };
const thStyle = { padding: '12px', textAlign: 'left', borderBottom: '2px solid #ddd' };
const tdStyle = { padding: '12px' };
const miniBtnStyle = { padding: '5px 10px', borderRadius: '5px', border: '1px solid #3498db', color: '#3498db', backgroundColor: 'transparent', cursor: 'pointer' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
const modalStyle = { backgroundColor: 'white', padding: '30px', borderRadius: '20px', width: '90%', maxWidth: '700px', textAlign: 'center' };

export default App;
