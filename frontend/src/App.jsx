// ... 前面 App 組件與考試邏輯維持原樣 ...

// --- 只更新 AdminPanel 內部的按鈕邏輯 ---
function AdminPanel() {
  const [tempQs, setTempQs] = useState([]);
  const [finalQs, setFinalQs] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(null);

  const fetchData = async () => {
    try {
      const [t, f, r] = await Promise.all([
        fetch(`${API_BASE}/admin/temp-questions`).then(res => res.json()),
        fetch(`${API_BASE}/admin/current-final`).then(res => res.json()),
        fetch(`${API_BASE}/admin/records`).then(res => res.json())
      ]);
      setTempQs(t || []);
      setFinalQs(f || []);
      setRecords(r || []);
    } catch (e) { console.error("資料載入失敗"); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleUpload = async (e) => {
    setLoading(true);
    const formData = new FormData();
    for (let f of e.target.files) formData.append('files', f);
    try {
      const res = await fetch(`${API_BASE}/generate-quiz`, { method: 'POST', body: formData });
      if (res.ok) {
        alert("✅ 20 題已加入草稿！您可以再次上傳以累積題數。");
        fetchData();
      } else { alert("❌ 生成失敗，請確認檔案大小或 API。"); }
    } catch (e) { alert("生成超時，但可能已在後端處理中，請稍後刷新。"); }
    setLoading(false);
  };

  const clearTemp = async () => {
    if (window.confirm("確定要清空目前的草稿嗎？")) {
      await fetch(`${API_BASE}/admin/temp-clear`, { method: 'DELETE' });
      fetchData();
    }
  };

  const publish = async () => {
    if (tempQs.length < 20) return alert("題庫至少需要 20 題才能發布！");
    if (!window.confirm(`確定發布這 ${tempQs.length} 題？這將成為夥伴目前的隨機題庫。`)) return;
    await fetch(`${API_BASE}/admin/publish-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tempQs)
    });
    alert("🚀 發布成功！");
    fetchData();
  };

  // ... 此處下方的 HTML 介面與上一版相同，但在草稿區多加一個按鈕 ...
  // 請在題庫管理區的生成按鈕下方加入：
  // <button onClick={clearTemp} style={{backgroundColor:'#e74c3c', color:'white', border:'none', padding:'5px 10px', borderRadius:'5px', cursor:'pointer'}}>🗑️ 清空草稿重來</button>
}
