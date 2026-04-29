import React, { useState, useEffect } from 'react';
const API_BASE = "https://sop-quiz-api.onrender.com";

function App() {
  const isAdmin = window.location.pathname.includes('/admin');
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [empId, setEmpId] = useState(''); // 🌟 員工工號
  const [questions, setQuestions] = useState([]);
  const [editList, setEditList] = useState([]);
  const [ans, setAns] = useState({});
  const [finalScore, setFinalScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [timeLeft, setTimeLeft] = useState(300); // 5分鐘倒數計時

  const fetchTemp = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/temp-questions`);
      setEditList(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const handlePublish = async () => {
    await fetch(`${API_BASE}/admin/publish-questions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editList)
    });
    alert("✅ 發布成功！考卷已更新。");
  };

  const submit = async () => {
    const res = await fetch(`${API_BASE}/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_name: name, emp_id: empId, answers: ans })
    });
    const data = await res.json();
    setFinalScore(data.score); 
    setStep(3);
  };

  // 🌟 新增：匯出成績為 CSV 檔案 (Excel 可直接開啟)
  const exportToCSV = () => {
    if (records.length === 0) {
      alert("目前沒有成績可以匯出喔！");
      return;
    }
    
    // 加入 BOM 以確保 Excel 開啟時中文不會變成亂碼
    let csvContent = "\uFEFF工號,姓名,得分\n";
    
    records.forEach(r => {
      csvContent += `${r.emp_id},${r.name},${r.score}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "SOP員工成績表.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (step === 2 && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
      return () => clearInterval(timer);
    } else if (step === 2 && timeLeft === 0) {
      alert("⏳ 時間到！系統自動交卷。"); 
      submit();
    }
  }, [step, timeLeft]);

  // ==========================================
  // 🛡️ 管理員後台介面
  // ==========================================
  if (isAdmin) return (
    <div style={{ padding: '30px', maxWidth: '900px', margin: 'auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#333' }}>🛡️ 店長後台管理</h1>
      
      <div style={{ background: '#f0f4f8', padding: '20px', borderRadius: '10px' }}>
        <p>上傳 SOP 文件 (AI 會自動產生 20 題)</p>
        <input type="file" multiple onChange={async (e) => {
          setLoading(true);
          const fd = new FormData();
          for (let f of e.target.files) fd.append("files", f);
          try {
            const res = await fetch(`${API_BASE}/generate-quiz`, { method: "POST", body: fd });
            if (res.ok) { fetchTemp(); alert("AI 生成完成！"); }
            else { alert("生成失敗，請檢查檔案內容"); }
          } catch(e) {
             alert("無法連接後端，請確認終端機有在運行");
          }
          setLoading(false);
        }} />
        {loading && <span style={{ color: 'blue', marginLeft: '10px' }}>⏳ AI 正在解析內容並出題中...</span>}
      </div>
      
      <hr style={{ margin: '30px 0' }} />
      
      {editList.length === 0 && <p>目前沒有草稿，請先上傳檔案。</p>}
      {editList.map((q, i) => (
        <div key={i} style={{ background: '#fff', padding: '20px', marginBottom: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <strong>題目 {i+1}：</strong>
          <textarea style={{ width: '100%', padding: '10px', marginTop: '10px', boxSizing: 'border-box' }} rows="2" value={q.q} onChange={e => {
            const nl = [...editList]; nl[i].q = e.target.value; setEditList(nl);
          }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px' }}>
            {['A','B','C','D'].map(k => (
              <div key={k}>{k}: <input style={{ width: '80%', padding: '5px' }} value={q.options[k]} onChange={e => {
                const nl = [...editList]; nl[i].options[k] = e.target.value; setEditList(nl);
              }} /></div>
            ))}
          </div>
          <div style={{ marginTop: '15px', borderTop: '1px dashed #ccc', paddingTop: '10px' }}>
            正確答案：<input style={{ width: '40px', textAlign: 'center' }} value={q.ans} onChange={e => {
              const nl = [...editList]; nl[i].ans = e.target.value.toUpperCase(); setEditList(nl);
            }} />
          </div>
        </div>
      ))}
      
      {editList.length > 0 && <button onClick={handlePublish} style={{width:'100%', padding:'15px', background:'#28a745', color:'#fff', border:'none', borderRadius:'8px', fontSize:'18px', cursor:'pointer'}}>🚀 發布正式考卷</button>}
      
      <div style={{ marginTop: '50px' }}>
        <h3>📊 員工成績管理</h3>
        <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
          <button onClick={async () => {
            const res = await fetch(`${API_BASE}/admin/records`);
            setRecords(await res.json());
          }} style={{ padding: '8px 15px', cursor:'pointer', background: '#007bff', color: '#fff', border: 'none', borderRadius: '5px' }}>🔄 刷新成績清單</button>
          
          {/* 🌟 匯出 Excel 按鈕 */}
          <button onClick={exportToCSV} style={{ padding: '8px 15px', cursor:'pointer', background: '#28a745', color: '#fff', border: 'none', borderRadius: '5px' }}>📥 匯出 Excel (CSV)</button>
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', background: '#fff' }}>
          <thead><tr style={{ background: '#eee' }}>
            <th style={{ padding: '10px', border: '1px solid #ccc' }}>工號</th>
            <th style={{ padding: '10px', border: '1px solid #ccc' }}>姓名</th>
            <th style={{ padding: '10px', border: '1px solid #ccc' }}>得分</th>
            <th style={{ padding: '10px', border: '1px solid #ccc' }}>操作</th>
          </tr></thead>
          <tbody>
            {records.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: '10px', border: '1px solid #ccc', textAlign: 'center' }}>{r.emp_id}</td>
                <td style={{ padding: '10px', border: '1px solid #ccc', textAlign: 'center' }}>{r.name}</td>
                <td style={{ padding: '10px', border: '1px solid #ccc', textAlign: 'center', fontWeight: 'bold', color: r.score >= 80 ? 'green' : 'red' }}>{r.score} 分</td>
                <td style={{ padding: '10px', border: '1px solid #ccc', textAlign: 'center' }}>
                  <button onClick={async () => {
                     if(!window.confirm(`確定要刪除 [${r.emp_id}] ${r.name} 的成績嗎？這會讓他可以重考。`)) return;
                     await fetch(`${API_BASE}/admin/records/${r.emp_id}`, { method: "DELETE" });
                     setRecords(records.filter(x => x.emp_id !== r.emp_id));
                  }} style={{ color: 'red', cursor: 'pointer', padding: '5px 10px', background: 'transparent', border: '1px solid red', borderRadius: '3px' }}>刪除重考</button>
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan="4" style={{ padding: '15px', textAlign: 'center', color: '#666' }}>尚無考試紀錄</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ==========================================
  // ✍️ 員工考試介面
  // ==========================================
  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      {step === 1 && (
        <div style={{ maxWidth: '400px', margin: 'auto', padding: '40px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', borderRadius: '15px', background: '#fff' }}>
          <h1 style={{ color: '#007bff' }}>SOP 考核系統</h1>
          <p style={{ color: '#666', marginBottom: '25px' }}>請輸入工號與姓名以開始測驗</p>
          
          <div style={{ textAlign: 'left', marginBottom: '15px' }}>
             <label style={{ fontWeight: 'bold', color: '#333' }}>員工工號：</label>
             <input style={{width:'100%', padding:'12px', marginTop:'8px', boxSizing:'border-box', border: '1px solid #ccc', borderRadius: '5px'}} placeholder="例如: 1001" value={empId} onChange={e => setEmpId(e.target.value)} />
          </div>
          <div style={{ textAlign: 'left', marginBottom: '30px' }}>
             <label style={{ fontWeight: 'bold', color: '#333' }}>員工姓名：</label>
             <input style={{width:'100%', padding:'12px', marginTop:'8px', boxSizing:'border-box', border: '1px solid #ccc', borderRadius: '5px'}} placeholder="例如: 王小明" value={name} onChange={e => setName(e.target.value)} />
          </div>
          
          <button onClick={async () => {
             if (!empId || !name) return alert("請完整填寫工號與姓名！");
             try {
                 const res = await fetch(`${API_BASE}/get-questions?emp_id=${empId}`);
                 if (res.status === 403) return alert("❌ 此工號已經參加過測驗，不可重複填寫！");
                 if (!res.ok) return alert("目前沒有準備好的考卷，請稍後再試。");
                 
                 setQuestions(await res.json()); 
                 setTimeLeft(300); // 確保每次進去都是 5 分鐘 (300秒)
                 setStep(2);
             } catch(e) {
                 alert("無法連接到伺服器！");
             }
          }} style={{width:'100%', padding:'14px', background:'#007bff', color:'#fff', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'18px', fontWeight: 'bold'}}>開始考試 (限時 5 分鐘)</button>
        </div>
      )}
      
      {step === 2 && (
        <div style={{ textAlign: 'left', maxWidth: '700px', margin: 'auto', position: 'relative' }}>
          
          {/* 懸浮時間條 */}
          <div style={{ 
            position: 'sticky', top: 0, background: 'rgba(255, 255, 255, 0.95)', 
            padding: '15px', borderRadius: '10px', boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
            marginBottom: '20px', textAlign: 'center', zIndex: 100,
            border: timeLeft <= 60 ? '3px solid #ff4d4f' : '3px solid #007bff',
            transition: 'border 0.3s'
          }}>
            <h2 style={{ margin: 0, color: timeLeft <= 60 ? '#ff4d4f' : '#007bff' }}>
              ⏳ 剩餘時間：{Math.floor(timeLeft/60).toString().padStart(2, '0')}:{(timeLeft%60).toString().padStart(2, '0')}
            </h2>
          </div>

          {questions.map((q, idx) => (
            <div key={q.id} style={{ marginBottom: '30px', padding: '25px', background: '#fff', border: '1px solid #eee', borderRadius: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.02)' }}>
              <p style={{ fontSize: '18px', fontWeight: 'bold', lineHeight: '1.5', color: '#333' }}>{idx+1}. {q.q}</p>
              <div style={{ marginTop: '15px' }}>
                {Object.entries(q.options).map(([k, v]) => (
                  <label key={k} style={{ display: 'block', margin: '12px 0', cursor: 'pointer', padding: '8px', borderRadius: '5px', _hover: { background: '#f8f9fa' } }}>
                    <input type="radio" name={`q${q.id}`} style={{ marginRight: '12px', transform: 'scale(1.3)' }} onChange={() => setAns({...ans, [q.id]: k})} /> 
                    <span style={{ fontSize: '16px' }}>{k}. {v}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button onClick={submit} style={{ width: '100%', padding: '20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '20px', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px', boxShadow: '0 4px 6px rgba(40,167,69,0.3)' }}>交卷並觀看成績</button>
        </div>
      )}
      
      {step === 3 && (
        <div style={{ marginTop: '80px', background: '#fff', padding: '50px', borderRadius: '15px', maxWidth: '500px', margin: '80px auto', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: '#333', fontSize: '28px' }}>測驗結束！</h2>
          <p style={{ color: '#666', fontSize: '18px' }}>您的得分是：</p>
          <div style={{ fontSize: '120px', color: finalScore >= 80 ? '#28a745' : '#dc3545', fontWeight: 'bold', margin: '10px 0' }}>{finalScore}</div>
          <p style={{ color: '#888', marginBottom: '30px' }}>{finalScore >= 80 ? '表現優異，繼續保持！' : '請再接再厲，多熟悉 SOP 喔！'}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '15px 40px', fontSize: '18px', cursor: 'pointer', background: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' }}>返回首頁</button>
        </div>
      )}
    </div>
  );
}
export default App;