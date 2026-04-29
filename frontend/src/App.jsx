import React, { useState, useEffect } from 'react';

// 請確保這裡的網址是你 Render 的 API 網址
const API_BASE = "https://sop-quiz-api.onrender.com"; 

function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.pathname === '/admin');
  const [view, setView] = useState('login'); // login, quiz, result
  const [user, setUser] = useState({ name: '', emp_id: '' });
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [score, setScore] = useState(0);

  // --- 夥伴考試邏輯 ---
  const startQuiz = async () => {
    if (!user.name || !user.emp_id) return alert("請填寫完整資訊");
    try {
      const res = await fetch(`${API_BASE}/get-questions?emp_id=${user.emp_id}`);
      if (res.status === 403) return alert("此工號已考過！");
      if (!res.ok) return alert("題庫尚未就緒，請聯絡店長");
      const data = await res.json();
      setQuestions(data);
      setView('quiz');
    } catch (e) { alert("連線失敗"); }
  };

  const submitQuiz = async () => {
    let correctCount = 0;
    const detail = questions.map(q => {
      const isCorrect = answers[q.id] === q.ans;
      if (isCorrect) correctCount++;
      return {
        q: q.q,
        userAns: answers[q.id] || "未答",
        correctAns: q.ans,
        isCorrect: isCorrect
      };
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
    } catch (e) { alert("提交失敗"); }
  };

  if (isAdmin) return <AdminPanel />;

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: 'auto', fontFamily: 'sans-serif' }}>
      {view === 'login' && (
        <div style={{ textAlign: 'center', border: '1px solid #ddd', padding: '30px', borderRadius: '15px' }}>
          <h2>🚀 SOP 夥伴考核系統</h2>
          <input placeholder="姓名" onChange={e => setUser({...user, name: e.target.value})} style={inputStyle} /><br/>
          <input placeholder="工號" onChange={e => setUser({...user, emp_id: e.target.value})} style={inputStyle} /><br/>
          <button onClick={startQuiz} style={btnStyle}>開始隨機抽題測驗</button>
        </div>
      )}
      {view === 'quiz' && (
        <div>
          <h3>📝 夥伴測驗 (隨機 20 題)</h3>
          {questions.map((q, idx) => (
            <div key={idx} style={{ marginBottom: '20px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
              <p><b>{idx + 1}. {q.q}</b></p>
              {Object.entries(q.options).map(([key, val]) => (
                <label key={key} style={{ display: 'block', margin: '5px 0', cursor: 'pointer' }}>
                  <input type="radio" name={`q${q.id}`} onChange={() => setAnswers({...answers, [q.id]: key})} /> {key}. {val}
                </label>
              ))}
            </div>
          ))}
          <button onClick={submitQuiz} style={btnStyle}>交卷並讀取分數</button>
        </div>
      )}
      {view === 'result' && (
        <div style={{ textAlign: 'center' }}>
          <h2>測驗結束！</h2>
          <h1 style={{ fontSize: '64px', color: score >= 80 ? '#28a745' : '#dc3545' }}>{score}分</h1>
          <p>{score >= 80 ? "🎊 恭喜及格！" : "再接再厲，可以回頭複習 SOP 喔！"}</p>
        </div>
      )}
    </div>
  );
}

// --- 🌟 專業版管理員面板 ---
function AdminPanel() {
  const [tempQs, setTempQs] = useState([]);
  const [finalQs, setFinalQs] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(null); // 用於彈窗顯示作答詳情

  const fetchData = async () => {
    try {
      const [t, f, r] = await Promise.all([
        fetch(`${API_BASE}/admin/temp-questions`).then(res => res.json()),
        fetch(`${API_BASE}/admin/current-final`).then(res => res.json()),
        fetch(`${API_BASE}/admin/records`).then(res => res.json())
      ]);
      setTempQs(t);
      setFinalQs(f);
      setRecords(r);
    } catch (e) { console.error("抓取失敗"); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleUpload = async (e) => {
    setLoading(true);
    const formData = new FormData();
    for (let f of e.target.files) formData.append('files', f);
    try {
      await fetch(`${API_BASE}/generate-quiz`, { method: 'POST', body: formData });
      alert("AI 已生成 50 題草稿！");
      fetchData();
    } catch (e) { alert("生成失敗"); }
    setLoading(false);
  };

  const publish = async () => {
    if (!window.confirm("確定要將這 50 題發布為目前題庫嗎？這會覆蓋舊題庫。")) return;
    await fetch(`${API_BASE}/admin/publish-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("發布成功！夥伴現在進來會隨機抽 20 題。");
    fetchData();
  };

  const clearRecords = async () => {
    if (window.confirm("確定要清空所有成績紀錄嗎？")) {
      await fetch(`${API_BASE}/admin/records/clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>🛡️ 店長管理後台</h1>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* 左側：題庫管理 */}
        <div style={cardStyle}>
          <h3>📚 題庫管理</h3>
          <div style={{ marginBottom: '10px' }}>
            <label style={btnStyle}> 📤 上傳 SOP 生成 50 題庫
              <input type="file" multiple hidden onChange={handleUpload} />
            </label>
            {loading && " 🚀 AI 思考中(約1-2分鐘)..."}
          </div>
          
          <div style={{ border: '1px solid #eee', padding: '10px', height: '300px', overflowY: 'auto', backgroundColor: '#f9f9f9' }}>
            <h4>目前運作中題庫 ({finalQs.length} 題)</h4>
            {finalQs.length === 0 ? <p>尚未發布任何題目</p> : 
              finalQs.map(q => <div key={q.id} style={{ fontSize: '12px' }}>{q.id}. {q.q}</div>)
            }
          </div>

          {tempQs.length > 0 && (
            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '10px' }}>
              <h4>🆕 AI 新生成的草稿 ({tempQs.length} 題)</h4>
              <button onClick={publish} style={{ ...btnStyle, backgroundColor: '#2196f3' }}>✅ 確認發布這 50 題</button>
            </div>
          )}
        </div>

        {/* 右側：成績紀錄 */}
        <div style={cardStyle}>
          <h3>📈 夥伴考核紀錄 <button onClick={clearRecords} style={{ fontSize: '12px', float: 'right' }}>清空</button></h3>
          <table style={{ width: '100%', textAlign: 'left' }}>
            <thead>
              <tr><th>工號</th><th>姓名</th><th>分數</th><th>作答詳情</th></tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.emp_id}>
                  <td>{r.emp_id}</td>
                  <td>{r.name}</td>
                  <td style={{ color: r.score >= 80 ? 'green' : 'red', fontWeight: 'bold' }}>{r.score}</td>
                  <td><button onClick={() => setShowDetail(r)}>👀 查看</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 詳細作答彈窗 */}
      {showDetail && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h3>夥伴 {showDetail.name} 的作答詳情</h3>
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {showDetail.detail.map((d, i) => (
                <div key={i} style={{ marginBottom: '10px', borderBottom: '1px solid #eee' }}>
                  <p>Q: {d.q}</p>
                  <p style={{ color: d.isCorrect ? 'green' : 'red' }}>
                    作答: {d.userAns} | 正確: {d.correctAns} {d.isCorrect ? '✅' : '❌'}
                  </p>
                </div>
              ))}
            </div>
            <button onClick={() => setShowDetail(null)} style={btnStyle}>關閉</button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = { padding: '10px', margin: '5px', width: '80%', borderRadius: '5px', border: '1px solid #ccc' };
const btnStyle = { padding: '10px 20px', margin: '10px', borderRadius: '5px', border: 'none', backgroundColor: '#007bff', color: 'white', cursor: 'pointer' };
const cardStyle = { border: '1px solid #ddd', padding: '20px', borderRadius: '15px', backgroundColor: 'white' };
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' };
const modalStyle = { backgroundColor: 'white', padding: '20px', borderRadius: '15px', width: '80%', maxWidth: '600px' };

export default App;
