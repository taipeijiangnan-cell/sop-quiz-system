import React, { useState, useEffect } from 'react';

const API_BASE = "https://sop-quiz-api.onrender.com"; 

function App() {
  const [isAdmin, setIsAdmin] = useState(window.location.pathname === '/admin');
  const [view, setView] = useState('login'); 
  const [user, setUser] = useState({ name: '', emp_id: '' });
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [score, setScore] = useState(0);

  useEffect(() => {
    document.title = isAdmin ? "考核系統後端" : "再睡五分鐘考核系統";
  }, [isAdmin]);

  const startQuiz = async () => {
    if (!user.name || !user.emp_id) return alert("請填寫姓名與工號");
    const chineseRegex = /^[\u4E00-\u9FA5]+$/;
    if (!chineseRegex.test(user.name)) return alert("姓名請輸入繁體中文！");

    try {
      const res = await fetch(`${API_BASE}/get-questions?emp_id=${user.emp_id}`);
      if (res.status === 403) return alert("此工號已完成考核！");
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
    await fetch(`${API_BASE}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...user, score: finalScore, detail: detail })
    });
    setView('result');
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
          <h3>✍️ 測驗中 (共 {questions.length} 題)</h3>
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
          <h1>您的分數：{score}</h1>
          <button onClick={() => window.location.reload()} style={btnStyle}>回到首頁</button>
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

  const fetchData = async () => {
    const [tRes, fRes, rRes] = await Promise.all([
      fetch(`${API_BASE}/admin/temp-questions`),
      fetch(`${API_BASE}/admin/current-final`),
      fetch(`${API_BASE}/admin/records`)
    ]);
    setTempQs(await tRes.json());
    setFinalQs(await fRes.json());
    setRecords(await rRes.json());
  };

  useEffect(() => { fetchData(); }, []);

  const handleUpload = async (e) => {
    setLoading(true);
    const formData = new FormData();
    for (let f of e.target.files) formData.append('files', f);
    const res = await fetch(`${API_BASE}/generate-quiz`, { method: 'POST', body: formData });
    if (res.ok) alert("AI 題目生成成功！");
    else alert("生成失敗，請嘗試手動出題或匯入。");
    fetchData();
    setLoading(false);
  };

  const addBlankQuestion = () => {
    const newId = tempQs.length > 0 ? Math.max(...tempQs.map(q => q.id)) + 1 : 1;
    const blank = { id: newId, q: "請輸入題目內容", options: { A: "", B: "", C: "", D: "" }, ans: "A" };
    setTempQs([...tempQs, blank]);
  };

  const saveTemp = async () => {
    await fetch(`${API_BASE}/admin/save-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("草稿儲存成功！");
  };

  // 🌟 新增功能：匯出成 JSON 檔案
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

  // 🌟 新增功能：從 JSON 檔案匯入
  const importDraftFromJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!Array.isArray(importedData)) throw new Error("格式不符");
        
        // 重新編號並確保格式正確
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
        
        // 自動幫忙存檔
        await fetch(`${API_BASE}/admin/save-temp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newDraft)
        });
        alert(`✅ 成功匯入 ${formattedData.length} 題並儲存至草稿！`);
      } catch (err) {
        alert("❌ 匯入失敗：檔案不是正確的題庫格式 (JSON)。");
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  const publish = async () => {
    if (!window.confirm("確定發布？這將覆蓋目前線上題庫。")) return;
    await fetch(`${API_BASE}/admin/publish-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("發布成功！");
    fetchData();
  };

  const deleteTempQuestion = (id) => {
    setTempQs(tempQs.filter(q => q.id !== id));
  };

  const updateDraft = (id, field, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, [field]: value } : q));
  };
  const updateOption = (id, optKey, value) => {
    setTempQs(tempQs.map(q => q.id === id ? { ...q, options: { ...q.options, [optKey]: value } } : q));
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif', backgroundColor: '#f4f7f6', minHeight: '100vh' }}>
      <h1 style={{ textAlign: 'center' }}>考核系統後端</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '30px' }}>
        <div style={cardStyle}>
          <h3>📚 題目草稿區</h3>
          
          {/* 🌟 按鈕區重新排版，加入匯入匯出 */}
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
            
            <button onClick={saveTemp} style={{ ...btnStyle, backgroundColor: '#2980b9', margin: 0 }}>💾 儲存草稿</button>
            <button onClick={publish} style={{ ...btnStyle, backgroundColor: '#27ae60', margin: 0 }}>🚀 正式發布</button>
          </div>

          <div style={{ height: '600px', overflowY: 'auto', border: '1px solid #ddd', padding: '15px', backgroundColor: '#fff' }}>
            {tempQs.map((q) => (
              <div key={q.id} style={{ borderBottom: '2px solid #eee', paddingBottom: '15px', marginBottom: '15px', position: 'relative' }}>
                <button onClick={() => deleteTempQuestion(q.id)} style={{ position: 'absolute', right: 0, top: 0, border: 'none', background: 'none', color: 'red', cursor: 'pointer' }}>❌ 刪除</button>
                <b>題目：</b>
                <textarea value={q.q} onChange={(e) => updateDraft(q.id, 'q', e.target.value)} style={{ width: '100%', display: 'block', margin: '5px 0' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {['A', 'B', 'C', 'D'].map(o => (
                    <div key={o}><b>{o}:</b> <input value={q.options[o]} onChange={(e) => updateOption(q.id, o, e.target.value)} style={{ width: '80%' }} /></div>
                  ))}
                </div>
                <b>正解：</b>
                <select value={q.ans} onChange={(e) => updateDraft(q.id, 'ans', e.target.value)}>
                  {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <h3>📈 成績紀錄</h3>
          <table style={{ width: '100%' }}>
            <thead><tr style={{ background: '#eee' }}><th>工號</th><th>姓名</th><th>分數</th></tr></thead>
            <tbody>
              {records.map(r => (
                <tr key={r.emp_id} style={{ textAlign: 'center' }}>
                  <td>{r.emp_id}</td><td>{r.name}</td><td>{r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: '12px', margin: '10px 0', width: '100%', borderRadius: '8px', border: '1px solid #bdc3c7' };
const btnStyle = { padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#3498db', color: 'white', fontWeight: 'bold', cursor: 'pointer', display: 'inline-block' };
const qBoxStyle = { marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '10px', borderLeft: '5px solid #3498db' };
const cardStyle = { backgroundColor: 'white', padding: '20px', borderRadius: '15px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' };

export default App;
