import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Save, X, Printer, FlaskConical, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { emptyPopupFields, extractPopupConfig, flattenPopupConfig, hasOwnPopupSteps } from '../../utils/popupConfig';
import { API_URL, nextItemId } from '../../utils/api';

// ปุ่มเลื่อนลำดับเมนูขึ้น/ลง
const ARROW_BTN = { padding: '0.15rem 0.4rem', lineHeight: 1, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: '0.72rem' };

const ManageMenu = () => {
  const { lang } = useOutletContext();
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  // สาขาทั้งหมด — ใช้ตั้งว่าเมนูขายเฉพาะสาขาไหน (มีสาขาเดียวไม่ต้องแสดงตัวเลือก)
  const [branchList, setBranchList] = useState([]);

  // ตารางเมนูเคยโชว์รหัสหมวดดิบ ๆ ซึ่งอ่านรู้เรื่องตอนรหัสเป็นคำอย่าง 'food'
  // พอรหัสเป็น HL##### ต้องแปลงเป็นชื่อหมวดก่อนแสดง
  const catLabel = (slug) => categories.find(c => c.slug === slug)?.name || slug || '—';
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // แสดงตามหมวด / จัดลำดับการแสดง
  const [categoryFilter, setCategoryFilter] = useState('');
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderMsg, setOrderMsg] = useState('');

  // BOM state
  const [bomConfig, setBomConfig] = useState({});
  const [ingredients, setIngredients] = useState([]);
  const [editingBom, setEditingBom] = useState([]); // BOM rows for current editing item
  const [showBom, setShowBom] = useState(false);
  const [showPopups, setShowPopups] = useState(false); // popup (order wizard) config section

  useEffect(() => {
    fetchMenu();
    loadPrinters();
    loadBomData();
    const handler = () => loadPrinters();
    window.addEventListener('printers_changed', handler);
    return () => window.removeEventListener('printers_changed', handler);
  }, []);

  const loadPrinters = () => {
    try {
      const stored = localStorage.getItem('printers_config');
      setPrinters(stored ? JSON.parse(stored) : []);
    } catch (e) { setPrinters([]); }
  };

  const loadBomData = () => {
    try {
      const bom = localStorage.getItem('bom_config');
      setBomConfig(bom ? JSON.parse(bom) : {});
    } catch(e) { setBomConfig({}); }
    try {
      const ing = localStorage.getItem('bom_ingredients');
      setIngredients(ing ? JSON.parse(ing) : []);
    } catch(e) { setIngredients([]); }
  };

  // BOM row helpers (for editingBom)
  const updateBomRow = (index, field, value) => {
    const rows = [...editingBom];
    rows[index] = { ...rows[index], [field]: value };
    if (field === 'ingId' && value) {
      const ing = ingredients.find(i => i.id === value);
      if (ing) {
        rows[index].ingName     = ing.name;
        rows[index].unit        = rows[index].unit || ing.unit || '';
        rows[index].costPerUnit = rows[index].costPerUnit !== undefined && rows[index].costPerUnit !== ''
          ? rows[index].costPerUnit : (ing.costPerUnit ?? ing.pricePerUnit ?? 0);
      }
    }
    setEditingBom(rows);
  };

  const addBomRow = () => setEditingBom(prev => [...prev, { ingId: '', ingName: '', qty: '', unit: '', costPerUnit: '' }]);
  const removeBomRow = (index) => setEditingBom(prev => prev.filter((_, i) => i !== index));

  const bomTotalCost = editingBom.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.costPerUnit) || 0), 0);

  const fetchMenu = async () => {
    // Clear stale cache first so fresh data always wins
    localStorage.removeItem('gas_all_data');
    setLoading(true);

    try {
      const resp = await fetch(API_URL + '?action=getAllData');
      const data = await resp.json();
      if (data) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        setMenuItems(Array.isArray(data.menu) ? data.menu.map(flattenPopupConfig) : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        setBranchList(Array.isArray(data.branches) ? data.branches.filter(b => b && b.id && b.isActive !== false) : []);
      }
    } catch(e) {
      console.error('Failed to fetch menu:', e);
    }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this menu item?')) {
      const updated = menuItems.filter(item => item.id !== id);
      try {
        await fetch(API_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'deleteMenu',
            id: id
          })
        });
        setMenuItems(updated);

        const cached = localStorage.getItem('gas_all_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            parsed.menu = updated;
            localStorage.setItem('gas_all_data', JSON.stringify(parsed));
            window.dispatchEvent(new Event('appDataChanged'));
          } catch(err) { console.error(err); }
        }
      } catch(e) {
        alert('Failed to delete from database');
      }
    }
  };

  const handleEdit = (item) => {
    // ensure popup fields exist (fall back to defaults for items never configured)
    const flat = flattenPopupConfig(item);
    const prices = Array.isArray(flat.prices) && flat.prices.length > 0
      ? flat.prices
      : [{ name: '', price: flat.price ?? '' }];
    setEditingItem({ ...emptyPopupFields(), ...flat, prices });
    setEditingBom(bomConfig[String(item.id)] || []);
    setShowBom(false);
    setShowPopups(false);
    setIsModalOpen(true);
  };

  const handleAddNew = async () => {
    // รหัสเดินต่อจากของเดิมเสมอ (SN00001, SN00002, …) ไม่ใช่ timestamp เหมือนเมื่อก่อน
    const id = await nextItemId([...menuItems.map(m => m.id), ...categories.map(c => c.slug)]);
    setEditingItem({
      id,
      category: categories[0]?.slug || '',
      categories: [],
      name: '',
      nameEn: '',
      description: '',
      descriptionEn: '',
      price: 0,
      image: '',
      isActive: true,
      bundledItems: [],
      printerId: '',
      branches: [],
      prices: [
        { name: 'ปกติ', price: '' },
        { name: 'Takehome', price: '' },
        { name: 'Deli', price: '' }
      ],
      ...emptyPopupFields()
    });
    setEditingBom([]);
    setShowBom(false);
    setShowPopups(false);
    setIsModalOpen(true);
  };

  // ── Multi-price helpers (สูงสุด 5 ราคา) ──
  const updatePriceRow = (idx, field, value) => {
    setEditingItem(prev => {
      const rows = [...(prev.prices || [])];
      rows[idx] = { ...rows[idx], [field]: value };
      return { ...prev, prices: rows };
    });
  };
  const addPriceRow = () => {
    setEditingItem(prev => {
      const rows = [...(prev.prices || [])];
      if (rows.length >= 5) return prev;
      return { ...prev, prices: [...rows, { name: '', price: '' }] };
    });
  };
  const removePriceRow = (idx) => {
    setEditingItem(prev => {
      const rows = (prev.prices || []).filter((_, i) => i !== idx);
      return { ...prev, prices: rows.length ? rows : [{ name: '', price: '' }] };
    });
  };

  // toggle an extra category slug for the current item (อยู่ได้หลายหมวด)
  const handleExtraCategoryToggle = (slug) => {
    setEditingItem(prev => {
      const current = Array.isArray(prev.categories) ? prev.categories : [];
      if (current.includes(slug)) return { ...prev, categories: current.filter(s => s !== slug) };
      return { ...prev, categories: [...current, slug] };
    });
  };

  // toggle a menu item id within a popup{n}Items array field
  const handlePopupItemToggle = (field, id) => {
    setEditingItem(prev => {
      const current = prev[field] || [];
      if (current.includes(id)) return { ...prev, [field]: current.filter(i => i !== id) };
      return { ...prev, [field]: [...current, id] };
    });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    // normalize prices: keep rows with a numeric price; legacy `price` = first row
    const cleanPrices = (editingItem.prices || [])
      .filter(p => p && p.price !== '' && p.price != null && !isNaN(Number(p.price)))
      .map(p => ({ name: (p.name || '').trim(), price: Number(p.price) }));
    const basePrice = cleanPrices.length > 0 ? cleanPrices[0].price : (Number(editingItem.price) || 0);
    // หมวดเพิ่มเติม: ไม่ซ้ำและไม่รวมหมวดหลัก (อยู่ได้หลายหมวด)
    const extraCategories = Array.isArray(editingItem.categories)
      ? [...new Set(editingItem.categories.filter(s => s && s !== editingItem.category))]
      : [];
    // bundle the flat popup fields into a single popupConfig object for storage
    const itemToSave = { ...editingItem, categories: extraCategories, prices: cleanPrices, price: basePrice, popupConfig: extractPopupConfig(editingItem) };
    let updated;
    if (menuItems.find(i => i.id === itemToSave.id)) {
      updated = menuItems.map(i => i.id === itemToSave.id ? itemToSave : i);
    } else {
      updated = [...menuItems, itemToSave];
    }

    try {
      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'upsertMenu',
          item: itemToSave
        })
      });
      setMenuItems(updated);
      setIsModalOpen(false);

      // Save BOM to localStorage
      const newBomConfig = { ...bomConfig, [String(editingItem.id)]: editingBom };
      setBomConfig(newBomConfig);
      localStorage.setItem('bom_config', JSON.stringify(newBomConfig));

      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          parsed.menu = updated;
          localStorage.setItem('gas_all_data', JSON.stringify(parsed));
          window.dispatchEvent(new Event('appDataChanged'));
        } catch(err) { console.error(err); }
      }
    } catch(err) {
      alert('Failed to save to database');
    }
  };

  const handleAutoTranslate = async (field) => {
    const textToTranslate = field === 'name' ? editingItem.name : editingItem.description;
    if (!textToTranslate) return;
    
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=th&tl=en&dt=t&q=${encodeURIComponent(textToTranslate)}`;
      const res = await fetch(url);
      const data = await res.json();
      const translatedText = data[0].map(item => item[0]).join('');
      
      if (field === 'name') {
        setEditingItem(prev => ({...prev, nameEn: translatedText}));
      } else {
        setEditingItem(prev => ({...prev, descriptionEn: translatedText}));
      }
    } catch(e) {
      console.error('Translation failed', e);
      alert('Translation failed. Please try again or enter manually.');
    }
  };

  // ย่อรูปก่อนส่ง — รูปจากมือถือมักใหญ่ 3-8 MB อัปตรง ๆ จะช้าและกินโควตาฝากรูปเปล่า ๆ
  // กว้าง 1000px พอสำหรับการ์ดเมนูแล้ว
  const fileToResizedDataUrl = (file, maxDim = 1000, quality = 0.85) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // อัปโหลดรูปเมนูไปที่ ImgBB แล้วเก็บ "ลิงก์" ที่ได้ลงคอลัมน์ image ของชีต Menu
  // → หน้าขาย/หน้าลูกค้าสั่งเอง ดึงลิงก์นี้ไปแสดงเอง
  //
  // ทำไมไม่ใช้ Google Drive: ลองแล้วติด "Access denied: DriveApp" ที่ฝั่ง Apps Script
  // (สิทธิ์ Drive ไม่ติดมากับโทเคนของเว็บแอป) โค้ดฝั่ง Apps Script ยังอยู่ครบ
  // เผื่ออยากกลับไปใช้ทีหลัง — เรียก action 'uploadImage' ได้เลย
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      const base64 = String(dataUrl).split(',')[1];
      if (!base64) throw new Error('อ่านไฟล์รูปไม่ได้');

      const IMGBB_API_KEY = 'c46b3eebbda2ef57c71cb885cb305fe5';
      const formData = new FormData();
      formData.append('image', base64); // ImgBB รับ base64 ตรง ๆ ได้ ไม่ต้องแนบเป็นไฟล์
      formData.append('name', (editingItem?.name || 'menu').toString().slice(0, 60));

      const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json().catch(() => null);

      if (data && data.success && data.data && data.data.display_url) {
        setEditingItem(prev => ({ ...prev, image: data.data.display_url }));
      } else {
        throw new Error((data && data.error && data.error.message) || 'ImgBB ไม่ตอบลิงก์รูปกลับมา');
      }
    } catch (err) {
      console.error('Image upload error:', err);
      alert(lang === 'th'
        ? 'อัปโหลดรูปไม่สำเร็จ: ' + (err.message || err) + '\n\nลองใหม่อีกครั้ง หรือเช็กอินเทอร์เน็ต'
        : 'Image upload failed: ' + (err.message || err));
    }
    setUploading(false);
  };

  const filteredMenu = menuItems.filter(item => {
    const searchLow = searchTerm.toLowerCase();
    const nameLow = (item.name || '').toLowerCase();
    const nameEnLow = (item.nameEn || '').toLowerCase();
    return nameLow.includes(searchLow) || nameEnLow.includes(searchLow);
  });


  // ── แสดงตามหมวด + จัดลำดับการแสดง ──
  // ลำดับใน menuItems = ลำดับที่หน้าขาย/หน้าลูกค้าแสดง (เซิร์ฟเวอร์ส่งมาเรียงตาม sortOrder แล้ว)
  // เมนูอยู่ในส่วนของหมวดหลัก (category) เท่านั้น หมวดเสริมใช้แสดงหน้าขายอย่างเดียว
  const priceOf = (item) => {
    const base = Number(item.price);
    if (Number.isFinite(base) && base > 0) return base;
    const opts = Array.isArray(item.prices) ? item.prices.map(p => Number(p && p.price)).filter(n => Number.isFinite(n) && n > 0) : [];
    return opts.length ? Math.min(...opts) : 0;
  };

  const menuGroups = (() => {
    const known = new Set(categories.map(c => c.slug));
    const groups = categories.map(c => ({ slug: c.slug, name: c.name || c.slug, icon: c.icon, items: menuItems.filter(m => m.category === c.slug) }));
    const others = menuItems.filter(m => !known.has(m.category));
    if (others.length) groups.push({ slug: '__none__', name: lang === 'th' ? 'ไม่มีหมวด' : 'Uncategorized', items: others });
    return groups.filter(g => g.items.length > 0 && (!categoryFilter || g.slug === categoryFilter));
  })();

  // เอาเมนูของหมวดนั้นไปวางกลับตำแหน่งเดิมใน menuItems ตามลำดับใหม่
  const reorderGroup = (slug, reordered) => {
    const inGroup = (m) => (slug === '__none__' ? !categories.some(c => c.slug === m.category) : m.category === slug);
    let k = 0;
    setMenuItems(prev => prev.map(m => (inGroup(m) ? reordered[k++] : m)));
    setOrderDirty(true);
    setOrderMsg('');
  };

  const moveItem = (group, index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= group.items.length) return;
    const next = [...group.items];
    [next[index], next[target]] = [next[target], next[index]];
    reorderGroup(group.slug, next);
  };

  const sortGroupByPrice = (group, asc) => {
    const next = [...group.items].sort((a, b) => (asc ? priceOf(a) - priceOf(b) : priceOf(b) - priceOf(a)));
    reorderGroup(group.slug, next);
  };

  const saveOrder = async () => {
    // บันทึกเรียงตามหมวด (ลำดับหมวดในหน้าหมวดหมู่) แล้วตามลำดับในหมวด
    const known = new Set(categories.map(c => c.slug));
    const ordered = [
      ...categories.flatMap(c => menuItems.filter(m => m.category === c.slug)),
      ...menuItems.filter(m => !known.has(m.category))
    ];
    setSavingOrder(true); setOrderMsg('');
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'saveMenuOrder', ids: ordered.map(m => String(m.id)) })
      });
      const json = await res.json().catch(() => null);
      if (!json || json.success !== true) {
        throw new Error(json && /Unknown action/i.test(json.error || '')
          ? 'API ยังเป็นรุ่นเก่า — รัน update-api.bat ก่อน'
          : (json && json.error) || 'เซิร์ฟเวอร์ไม่ตอบ success');
      }
      setMenuItems(ordered);
      try {
        const d = JSON.parse(localStorage.getItem('gas_all_data') || '{}');
        if (Array.isArray(d.menu)) {
          const pos = new Map(ordered.map((m, i) => [String(m.id), i]));
          d.menu = [...d.menu].sort((a, b) => (pos.get(String(a.id)) ?? 1e9) - (pos.get(String(b.id)) ?? 1e9));
          localStorage.setItem('gas_all_data', JSON.stringify(d));
          window.dispatchEvent(new Event('appDataChanged'));
        }
      } catch {}
      setOrderDirty(false);
      setOrderMsg(lang === 'th' ? '✅ บันทึกลำดับแล้ว — หน้าขายเห็นภายใน 1 นาที' : '✅ Order saved');
    } catch (e) {
      setOrderMsg(`❌ ${lang === 'th' ? 'บันทึกลำดับไม่สำเร็จ' : 'Save failed'}: ${e.message || e}`);
    }
    setSavingOrder(false);
  };

  const tableHead = (withOrder) => (
    <tr>
      {withOrder && <th>{lang === 'th' ? 'ลำดับ' : 'Order'}</th>}
      <th>{lang === 'th' ? 'รูปภาพ' : 'Image'}</th>
      <th>{lang === 'th' ? 'ชื่อ (TH/EN)' : 'Name (TH/EN)'}</th>
      <th>{lang === 'th' ? 'หมวดหมู่' : 'Category'}</th>
      <th>{lang === 'th' ? 'ราคา' : 'Price'}</th>
      <th>{lang === 'th' ? 'เครื่องปริ้น' : 'Printer'}</th>
      <th>{lang === 'th' ? 'สถานะ' : 'Status'}</th>
      <th>{lang === 'th' ? 'จัดการ' : 'Actions'}</th>
    </tr>
  );

  // แถวเมนูหนึ่งแถว — orderCell = ช่องปุ่มเลื่อนลำดับ (โหมดค้นหาไม่มีช่องนี้)
  const renderRow = (item, orderCell = null) => (
                  <tr key={item.id}>
                    {orderCell}
                    <td>
                      <img
                        src={item.image || `/images/item_${item.id}.svg`}
                        alt="food"
                        referrerPolicy="no-referrer"
                        style={{ width: '50px', height: '50px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                        onError={(e) => {
                          const sanitized = (item.name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
                          if (!e.target.dataset.tried) {
                            e.target.dataset.tried = 'true';
                            e.target.src = `/images/${sanitized}.svg`;
                          }
                        }}
                      />
                    </td>
                    <td>
                      <strong>{item.name}</strong><br/>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)'}}>{item.nameEn}</span>
                    </td>
                    <td>
                       <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                         <span style={{ background: 'rgba(249,115,22,0.18)', border: '1px solid rgba(249,115,22,0.35)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                           {catLabel(item.category)}
                         </span>
                         {Array.isArray(item.categories) && item.categories.map(slug => (
                           <span key={slug} style={{ background: 'rgba(255,255,255,0.1)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                             +{catLabel(slug)}
                           </span>
                         ))}
                       </div>
                    </td>
                    <td style={{ color: 'var(--accent)', fontWeight: 'bold' }}>฿{item.price}</td>
                    <td>
                      {(() => {
                        const p = printers.find(pr => String(pr.id) === String(item.printerId));
                        return p ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', background: 'rgba(255,255,255,0.07)', padding: '0.25rem 0.55rem', borderRadius: '6px', whiteSpace: 'nowrap' }}>
                            <Printer size={13} /> {p.name || p.ip}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        );
                      })()}
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        background: item.isActive !== false ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: item.isActive !== false ? '#22c55e' : '#ef4444'
                      }}>
                        {item.isActive !== false ? (lang === 'th' ? 'เปิด' : 'Active') : (lang === 'th' ? 'ซ่อน' : 'Hidden')}
                      </span>
                      {Array.isArray(item.branches) && item.branches.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: '0.75rem', color: '#2563eb', fontWeight: 600 }}>
                          🏠 {item.branches.map(id => (branchList.find(b => String(b.id) === String(id)) || {}).name || id).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="admin-btn secondary" style={{ marginRight: '0.5rem', padding: '0.4rem' }} onClick={() => handleEdit(item)}>
                        <Edit2 size={16} />
                      </button>
                      <button className="admin-btn danger" style={{ padding: '0.4rem' }} onClick={() => handleDelete(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
  );

  return (
    <div>
      <div className="admin-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>{lang === 'th' ? 'จัดการเมนู' : 'Manage Menu'}</h1>
          <p>{lang === 'th' ? 'เพิ่ม แก้ไข หรือลบรายการอาหารและเครื่องดื่ม' : 'Add, edit, or remove food and drinks.'}</p>
        </div>
        <button className="admin-btn" onClick={handleAddNew}>
          <Plus size={20} /> {lang === 'th' ? 'เพิ่มเมนูใหม่' : 'Add New Menu'}
        </button>
      </div>

      <div className="admin-card">
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input 
            type="text" 
            placeholder={lang === 'th' ? 'ค้นหาเมนู (TH/EN)...' : 'Search menu...'} 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="admin-search-input"
            style={{ width: '100%', maxWidth: '320px' }}
          />
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} disabled={!!searchTerm.trim()}
            style={{ padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontFamily: 'inherit', background: '#fff' }}>
            <option value="">{lang === 'th' ? 'ทุกหมวด' : 'All categories'}</option>
            {categories.map(c => <option key={c.slug} value={c.slug}>{c.icon ? `${c.icon} ` : ''}{c.name || c.slug}</option>)}
          </select>
          <button className="admin-btn" onClick={saveOrder} disabled={!orderDirty || savingOrder}
            style={{ padding: '0.55rem 1rem', opacity: orderDirty ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Save size={16} /> {savingOrder ? (lang === 'th' ? 'กำลังบันทึก...' : 'Saving...') : (lang === 'th' ? 'บันทึกลำดับการแสดง' : 'Save order')}
          </button>
          {orderMsg && <span style={{ fontSize: '0.85rem', color: orderMsg.startsWith('✅') ? '#16a34a' : '#dc2626' }}>{orderMsg}</span>}
          {orderDirty && !orderMsg && <span style={{ fontSize: '0.82rem', color: '#b45309' }}>{lang === 'th' ? 'มีการเปลี่ยนลำดับ ยังไม่ได้บันทึก' : 'Unsaved order changes'}</span>}
        </div>
        {searchTerm.trim() && (
          <p style={{ margin: '-0.5rem 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {lang === 'th' ? 'ล้างช่องค้นหาเพื่อจัดลำดับการแสดง' : 'Clear search to reorder'}
          </p>
        )}
        {loading ? <p>{lang === 'th' ? 'กำลังโหลดข้อมูลเมนู...' : 'Loading menu from database...'}</p> : searchTerm.trim() ? (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>{tableHead(false)}</thead>
              <tbody>
                {filteredMenu.length > 0 ? filteredMenu.map(item => renderRow(item)) : (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      {lang === 'th' ? 'ไม่พบเมนูที่ค้นหา' : 'No menu found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : menuGroups.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            {lang === 'th' ? 'ไม่มีรายการเมนู ลองเริ่มต้นเพิ่มสิ่งแรกดูสิ!' : 'No menu items found. Get started by adding a new product!'}
          </p>
        ) : menuGroups.map(group => (
          <div key={group.slug} style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '0 0 0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
                {group.icon ? `${group.icon} ` : ''}{group.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.85rem' }}>({group.items.length})</span>
              </h3>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button className="admin-btn secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => sortGroupByPrice(group, true)}>
                  {lang === 'th' ? 'ราคา น้อย → มาก' : 'Price low → high'}
                </button>
                <button className="admin-btn secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.8rem' }} onClick={() => sortGroupByPrice(group, false)}>
                  {lang === 'th' ? 'ราคา มาก → น้อย' : 'Price high → low'}
                </button>
              </div>
            </div>
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>{tableHead(true)}</thead>
                <tbody>
                  {group.items.map((item, idx) => renderRow(item, (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span style={{ minWidth: 20, textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{idx + 1}</span>
                        <button type="button" title={lang === 'th' ? 'เลื่อนขึ้น' : 'Move up'} disabled={idx === 0} onClick={() => moveItem(group, idx, -1)} style={{ ...ARROW_BTN, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                        <button type="button" title={lang === 'th' ? 'เลื่อนลง' : 'Move down'} disabled={idx === group.items.length - 1} onClick={() => moveItem(group, idx, 1)} style={{ ...ARROW_BTN, opacity: idx === group.items.length - 1 ? 0.3 : 1 }}>▼</button>
                      </div>
                    </td>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && editingItem && (
        <div className="admin-modal-overlay">
          <div className="admin-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2>{editingItem.name ? (lang === 'th' ? 'แก้ไขเมนู' : 'Edit Menu') : (lang === 'th' ? 'เพิ่มเมนูใหม่' : 'Add New Menu')}</h2>
              <button style={{ background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleFormSubmit}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label>{lang === 'th' ? 'ชื่อ (ภาษาไทย)' : 'Name (Thai)'}</label>
                  <input required value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
                </div>
                <div className="admin-form-group" style={{ flex: 1 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {lang === 'th' ? 'ชื่อ (ภาษาอังกฤษ)' : 'Name (English)'}
                    <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleAutoTranslate('name')}>✨ {lang === 'th' ? 'แปลอัตโนมัติ' : 'Auto Translate'}</span>
                  </label>
                  <input value={editingItem.nameEn} onChange={e => setEditingItem({...editingItem, nameEn: e.target.value})} />
                </div>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'รายละเอียด (ภาษาไทย)' : 'Description (Thai)'}</label>
                <textarea rows="2" value={editingItem.description} onChange={e => setEditingItem({...editingItem, description: e.target.value})} />
              </div>
              
              <div className="admin-form-group">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                   {lang === 'th' ? 'รายละเอียด (ภาษาอังกฤษ)' : 'Description (English)'}
                   <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => handleAutoTranslate('description')}>✨ {lang === 'th' ? 'แปลอัตโนมัติ' : 'Auto Translate'}</span>
                </label>
                <textarea rows="2" value={editingItem.descriptionEn} onChange={e => setEditingItem({...editingItem, descriptionEn: e.target.value})} />
              </div>

              {/* ── ราคา (ตั้งชื่อประเภทได้ สูงสุด 5) ── */}
              <div className="admin-form-group">
                <label>{lang === 'th' ? 'ราคา (ตั้งชื่อประเภทได้ สูงสุด 5 ราคา)' : 'Prices (named, up to 5)'}</label>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {lang === 'th' ? 'ถ้ามีมากกว่า 1 ราคา ลูกค้าจะเลือกประเภทราคาตอนสั่ง (เช่น เล็ก/ใหญ่, ปกติ/พิเศษ)' : 'If more than one, customers choose the price type when ordering.'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(editingItem.prices || []).map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={row.name || ''}
                        onChange={e => updatePriceRow(idx, 'name', e.target.value)}
                        placeholder={lang === 'th' ? (idx === 0 ? 'ชื่อราคา (เช่น ปกติ)' : 'ชื่อราคา (เช่น พิเศษ)') : 'Price name'}
                        style={{ flex: 2, padding: '0.55rem 0.7rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '8px', margin: 0 }}
                      />
                      <div style={{ position: 'relative', flex: 1 }}>
                        <span style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>฿</span>
                        <input
                          type="number" min="0"
                          value={row.price ?? ''}
                          onChange={e => updatePriceRow(idx, 'price', e.target.value)}
                          placeholder="0"
                          style={{ width: '100%', padding: '0.55rem 0.7rem 0.55rem 1.4rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '8px', margin: 0, boxSizing: 'border-box' }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removePriceRow(idx)}
                        disabled={(editingItem.prices || []).length <= 1}
                        title={lang === 'th' ? 'ลบราคานี้' : 'Remove'}
                        style={{ background: 'none', border: 'none', color: (editingItem.prices || []).length <= 1 ? '#cbd5e1' : '#ef4444', cursor: (editingItem.prices || []).length <= 1 ? 'not-allowed' : 'pointer', padding: '0.3rem', display: 'flex' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {(editingItem.prices || []).length < 5 && (
                    <button type="button" className="admin-btn secondary" onClick={addPriceRow} style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem' }}>
                      <Plus size={14} /> {lang === 'th' ? 'เพิ่มราคา' : 'Add price'}
                    </button>
                  )}
                  {!(editingItem.prices || []).some(p => p.name === 'ปกติ') && (
                    <button
                      type="button" className="admin-btn secondary"
                      onClick={() => setEditingItem(prev => ({ ...prev, prices: [...(prev.prices || []), { name: 'ปกติ', price: '' }] }))}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)' }}
                    >
                      + 🪑 ปกติ
                    </button>
                  )}
                  {!(editingItem.prices || []).some(p => p.name === 'Takehome') && (
                    <button
                      type="button" className="admin-btn secondary"
                      onClick={() => setEditingItem(prev => ({ ...prev, prices: [...(prev.prices || []), { name: 'Takehome', price: '' }] }))}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)' }}
                    >
                      + 🛍️ Takehome
                    </button>
                  )}
                  {!(editingItem.prices || []).some(p => p.name === 'Deli') && (
                    <button
                      type="button" className="admin-btn secondary"
                      onClick={() => setEditingItem(prev => ({ ...prev, prices: [...(prev.prices || []), { name: 'Deli', price: '' }] }))}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.05)' }}
                    >
                      + 🛵 Deli
                    </button>
                  )}
                </div>
              </div>

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'หมวดหมู่หลัก' : 'Primary Category'}</label>
                <select value={editingItem.category} onChange={e => setEditingItem({...editingItem, category: e.target.value})}>
                  {categories.length > 0 ? (
                    categories.map(c => <option key={c.slug} value={c.slug}>{lang === 'th' ? c.name : c.nameEn}</option>)
                  ) : (
                    <>
                      <option value="food">{lang === 'th' ? 'อาหาร' : 'Food'}</option>
                      <option value="drink">{lang === 'th' ? 'เครื่องดื่ม' : 'Drink'}</option>
                    </>
                  )}
                </select>
              </div>

              {categories.length > 0 && (
                <div className="admin-form-group">
                  <label>{lang === 'th' ? 'อยู่ในหมวดเพิ่มเติม (เลือกได้หลายหมวด)' : 'Also show in (multiple categories)'}</label>
                  {(() => {
                    const picked = Array.isArray(editingItem.categories) ? editingItem.categories : [];
                    // หมวดหลักไม่ต้องเลือกซ้ำ และที่เลือกไปแล้วก็ไม่ต้องโผล่ในรายการให้เลือกอีก
                    const pickable = categories.filter(c => c.slug !== editingItem.category && !picked.includes(c.slug));
                    const pickedCats = picked
                      .filter(slug => slug !== editingItem.category)
                      .map(slug => categories.find(c => c.slug === slug) || { slug, name: slug, nameEn: slug });

                    return (
                      <>
                        <select
                          value=""
                          disabled={pickable.length === 0}
                          onChange={e => { if (e.target.value) handleExtraCategoryToggle(e.target.value); }}
                        >
                          <option value="">
                            {pickable.length === 0
                              ? (lang === 'th' ? '— เลือกครบทุกหมวดแล้ว —' : '— All categories added —')
                              : (lang === 'th' ? '— เลือกหมวดที่จะเพิ่ม —' : '— Add a category —')}
                          </option>
                          {pickable.map(c => (
                            <option key={c.slug} value={c.slug}>{lang === 'th' ? c.name : c.nameEn}</option>
                          ))}
                        </select>

                        {pickedCats.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.6rem' }}>
                            {pickedCats.map(c => (
                              <span
                                key={c.slug}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                  padding: '0.35rem 0.5rem 0.35rem 0.7rem', borderRadius: '999px',
                                  background: 'rgba(234,179,8,0.18)', border: '1.5px solid var(--accent)',
                                  fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)'
                                }}
                              >
                                {lang === 'th' ? c.name : c.nameEn}
                                <button
                                  type="button"
                                  onClick={() => handleExtraCategoryToggle(c.slug)}
                                  title={lang === 'th' ? 'เอาออก' : 'Remove'}
                                  style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: '1.15rem', height: '1.15rem', padding: 0, borderRadius: '999px',
                                    border: 'none', background: 'rgba(0,0,0,0.12)', color: 'var(--text-main)',
                                    fontSize: '0.85rem', lineHeight: 1, cursor: 'pointer'
                                  }}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {lang === 'th'
                              ? 'ยังไม่ได้เลือกหมวดเพิ่มเติม — เมนูนี้จะขึ้นเฉพาะในหมวดหลักเท่านั้น'
                              : 'No extra categories — this item shows only in its primary category.'}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="admin-form-group">
                <label>{lang === 'th' ? 'รูปภาพ (อัปโหลดจากเครื่อง หรือวาง URL)' : 'Image (Upload from this device, or paste a URL)'}</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} style={{ flex: 1, padding: '0.5rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '8px' }} />
                  {uploading && <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{lang === 'th' ? 'กำลังอัปโหลด...' : 'Uploading...'}</span>}
                </div>
                <input value={editingItem.image} onChange={e => setEditingItem({...editingItem, image: e.target.value})} placeholder={lang === 'th' ? 'หรือวางลิงก์รูปภาพที่นี่' : 'Or paste image URL here'} />
                {editingItem.image && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <img src={editingItem.image} alt="Preview" referrerPolicy="no-referrer" style={{ height: '80px', borderRadius: '8px', objectFit: 'cover' }} />
                  </div>
                )}
                <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {lang === 'th'
                    ? 'ไฟล์จะถูกย่อเหลือกว้างสุด 1000px ก่อนอัปโหลด — อย่าลืมกดบันทึก แล้วรูปจะขึ้นในหน้าขายและหน้าลูกค้าสั่งเองอัตโนมัติ'
                    : 'Files are resized to max 1000px before upload — remember to save; the photo then shows on the POS and kiosk screens.'}
                </div>
              </div>

              <div className="admin-form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="menu-active"
                  checked={editingItem.isActive !== false}
                  onChange={e => setEditingItem({...editingItem, isActive: e.target.checked})}
                  style={{ width: 'auto', marginBottom: 0 }}
                />
                <label htmlFor="menu-active" style={{ marginBottom: 0, cursor: 'pointer' }}>
                  {lang === 'th' ? 'เปิดใช้งาน (แสดงบนหน้าร้าน)' : 'Active (Show on storefront)'}
                </label>
              </div>

              {/* สาขาที่ขายเมนูนี้ */}
              {branchList.length > 1 && (() => {
                const chosen = Array.isArray(editingItem.branches) ? editingItem.branches.map(String) : [];
                const allBranches = chosen.length === 0;
                const toggle = (id) => {
                  const next = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id];
                  setEditingItem({ ...editingItem, branches: next });
                };
                return (
                  <div className="admin-form-group" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                    <label style={{ marginBottom: '0.5rem', display: 'block' }}>{lang === 'th' ? 'แสดงที่สาขา' : 'Sold at branches'}</label>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => setEditingItem({ ...editingItem, branches: [] })}
                        style={{ padding: '0.4rem 0.8rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: allBranches ? 700 : 500,
                          border: `1.5px solid ${allBranches ? 'var(--accent)' : 'rgba(0,0,0,0.15)'}`, background: allBranches ? 'rgba(234,179,8,0.15)' : '#fff', color: 'var(--text-main)' }}>
                        {lang === 'th' ? 'ทุกสาขา' : 'All branches'}
                      </button>
                      {branchList.map(b => {
                        const on = chosen.includes(String(b.id));
                        return (
                          <button type="button" key={b.id} onClick={() => toggle(String(b.id))}
                            style={{ padding: '0.4rem 0.8rem', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: on ? 700 : 500,
                              border: `1.5px solid ${on ? '#2563eb' : 'rgba(0,0,0,0.15)'}`, background: on ? 'rgba(37,99,235,0.1)' : '#fff', color: 'var(--text-main)' }}>
                            {on ? '✓ ' : ''}{b.name || b.id}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {lang === 'th'
                        ? (allBranches ? 'ขายทุกสาขา (รวมสาขาที่เพิ่มใหม่ในอนาคต)' : 'สาขาที่ไม่ได้เลือกจะไม่เห็นเมนูนี้เลย ทั้งหน้าขายและหน้าลูกค้า — ต้องรัน update-api.bat ก่อนถึงจะมีผล')
                        : (allBranches ? 'Sold at every branch' : 'Unselected branches will not see this item at all.')}
                    </div>
                  </div>
                );
              })()}

              {/* Printer Selection */}
              <div className="admin-form-group" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <Printer size={15} /> {lang === 'th' ? 'ส่งปริ้นไปที่เครื่อง' : 'Send to Printer'}
                </label>
                {printers.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0 }}>
                    ยังไม่มีเครื่องพิมพ์ — ไปตั้งค่าที่หน้า <strong>ปริ้นเตอร์</strong> ก่อน
                  </p>
                ) : (
                  <select
                    value={editingItem.printerId || ''}
                    onChange={e => setEditingItem({ ...editingItem, printerId: e.target.value })}
                  >
                    <option value="">— ไม่ระบุ —</option>
                    {printers.map(p => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name || p.ip} ({p.type})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Bundled Items */}
              <div className="admin-form-group" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <label style={{ marginBottom: '0.5rem', display: 'block' }}>
                  {lang === 'th' ? 'เมนูที่เพิ่มอัตโนมัติเมื่อสั่ง (Bundled Items):' : 'Auto-add items when ordered (Bundled Items):'}
                </label>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  {lang === 'th' ? 'ระบุจำนวนที่ต้องการให้เพิ่มเข้าตะกร้าอัตโนมัติทุกครั้งที่สั่งเมนูนี้' : 'Specify the quantity to automatically add to cart every time this menu is ordered'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {menuItems.filter(m => String(m.id) !== String(editingItem.id) && m.isActive !== false).map(m => {
                    const count = (editingItem.bundledItems || []).filter(bId => String(bId) === String(m.id)).length;
                    const updateCount = (newCount) => {
                      let parsed = parseInt(newCount) || 0;
                      if (parsed < 0) parsed = 0;
                      const others = (editingItem.bundledItems || []).map(String).filter(bId => bId !== String(m.id));
                      for(let i=0; i<parsed; i++) others.push(String(m.id));
                      setEditingItem({ ...editingItem, bundledItems: others });
                    };
                    
                    return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                      <input
                        type="number"
                        min="0"
                        value={count === 0 ? '' : count}
                        placeholder="0"
                        onChange={e => updateCount(e.target.value)}
                        style={{ width: '60px', padding: '0.2rem', margin: 0, background: 'var(--bg-main)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: '4px', textAlign: 'center' }}
                      />
                      <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => updateCount(count === 0 ? 1 : 0)}>
                        <span style={{ fontWeight: count > 0 ? 'bold' : 'normal', color: count > 0 ? 'var(--accent-hover)' : 'inherit' }}>{m.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>(฿{m.price})</span>
                      </span>
                    </div>
                  )})}
                </div>
              </div>

              {/* ── Popup / ตัวเลือกตอนสั่ง (Order Wizard) ───────────── */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowPopups(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer',
                    fontWeight: 600, fontSize: '0.9rem', padding: 0, marginBottom: showPopups ? '1rem' : 0,
                    width: '100%', textAlign: 'left'
                  }}
                >
                  <SlidersHorizontal size={16} style={{ color: 'var(--accent-hover)' }} />
                  {lang === 'th' ? 'ตัวเลือกตอนสั่ง (Popup)' : 'Order Options (Popups)'}
                  {(() => {
                    const n = [1,2,3,4,5,6].filter(i => editingItem[`hasPopup${i}`] === true).length;
                    return n > 0 ? (
                      <span style={{ background: 'rgba(34,197,94,0.18)', color: '#16a34a', padding: '0.1rem 0.45rem', borderRadius: 4, fontSize: '0.73rem', fontWeight: 700 }}>
                        {n} {lang === 'th' ? 'ป๊อปอัพ' : 'popups'}
                      </span>
                    ) : null;
                  })()}
                  <ChevronRight size={14} style={{ marginLeft: 'auto', transform: showPopups ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {showPopups && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                      {lang === 'th' ? 'ตั้งค่าหน้าจอเลือกตัวเลือกของเมนูนี้โดยเฉพาะ (ย้ายมาจากหน้าหมวดหมู่)' : 'Configure the order wizard steps for this specific item.'}
                    </p>
                    {[1, 2, 3, 4, 5, 6].map(num => {
                      const hasPopup = editingItem[`hasPopup${num}`];
                      const categoryProp = `popup${num}Category`;
                      const itemsProp = `popup${num}Items`;
                      const itemsMaxProp = `popup${num}ItemsMax`;
                      const minProp = `popup${num}Min`;
                      const maxProp = `popup${num}Max`;
                      const freeProp = `popup${num}Free`;
                      const repeatProp = `popup${num}AllowRepeat`;
                      const separateProp = `popup${num}Separate`;

                      return (
                        <div key={num} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                            <input type="checkbox" checked={hasPopup === true} onChange={e => setEditingItem({ ...editingItem, [`hasPopup${num}`]: e.target.checked })} style={{ width: 'auto', marginBottom: 0 }} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{lang === 'th' ? `แสดง Popup ${num}` : `Show Popup ${num}`}</span>
                          </label>
                          {hasPopup === true && (
                            <div style={{ marginLeft: '1.5rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '0.75rem', borderRadius: '8px' }}>
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label>{lang === 'th' ? 'ดึงเมนูจากหมวดหมู่:' : 'Pull items from category:'}</label>
                                <select
                                  value={editingItem[categoryProp] || ''}
                                  onChange={e => setEditingItem({ ...editingItem, [categoryProp]: e.target.value, [itemsProp]: [] })}
                                  style={{ padding: '0.5rem', width: '100%', borderRadius: '4px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }}
                                >
                                  <option value="">{lang === 'th' ? '-- เลือกหมวดหมู่ --' : '-- Select Category --'}</option>
                                  {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                                </select>
                              </div>
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label>{lang === 'th' ? 'บังคับเลือกอย่างน้อยกี่รายการ (0 = ไม่บังคับ):' : 'Min Required (0 = Optional):'}</label>
                                <input type="number" min="0" value={editingItem[minProp] || 0} onChange={e => setEditingItem({ ...editingItem, [minProp]: parseInt(e.target.value) || 0 })} style={{ width: '120px', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }} />
                              </div>
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label>{lang === 'th' ? 'จำกัดจำนวนสูงสุด (0 = ไม่จำกัด):' : 'Max Allowed (0 = Unlimited):'}</label>
                                <input type="number" min="0" value={editingItem[maxProp] || 0} onChange={e => setEditingItem({ ...editingItem, [maxProp]: parseInt(e.target.value) || 0 })} style={{ width: '120px', padding: '0.4rem', borderRadius: '4px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)' }} />
                              </div>
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                                  <input type="checkbox" checked={editingItem[freeProp] === true} onChange={e => setEditingItem({ ...editingItem, [freeProp]: e.target.checked })} style={{ width: 'auto', marginBottom: 0 }} />
                                  <span style={{ fontSize: '0.85rem' }}>{lang === 'th' ? 'ฟรี (ไม่บวกราคาเพิ่มในบิล)' : 'Free (Does not add cost)'}</span>
                                </label>
                              </div>
                              {/* แยกเป็นรายการของตัวเอง หรือเป็นตัวเลือกใต้เมนูหลัก */}
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                                  <input type="checkbox" checked={editingItem[separateProp] !== false} onChange={e => setEditingItem({ ...editingItem, [separateProp]: e.target.checked })} style={{ width: 'auto', marginBottom: 0 }} />
                                  <span style={{ fontSize: '0.85rem' }}>{lang === 'th' ? 'แยกเป็นรายการต่างหาก (ขึ้นคนละบรรทัดในบิล/ใบครัว)' : 'List as its own order line'}</span>
                                </label>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '1.5rem' }}>
                                  {lang === 'th'
                                    ? 'ค่าเริ่มต้นคือแยก — รายการฟรีจะขึ้นเป็น ฿0 รายการที่คิดเงินจะติดราคาของตัวเองไปด้วย และวิ่งไปเครื่องพิมพ์ของเมนูนั้นเอง ติ๊กออกถ้าเป็นตัวเลือกล้วน ๆ (เผ็ดน้อย/ไข่ดาว) ที่อยากให้ห้อยใต้เมนูหลัก'
                                    : 'On by default — free picks show as ฿0, paid picks carry their own price, and each routes to that item’s printer. Untick for pure options (spice level, fried egg).'}
                                </div>
                              </div>
                              {/* เลือกซ้ำได้ / ไม่ได้ */}
                              <div className="admin-form-group" style={{ marginBottom: '0.5rem' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                                  <input type="checkbox" checked={editingItem[repeatProp] !== false} onChange={e => setEditingItem({ ...editingItem, [repeatProp]: e.target.checked })} style={{ width: 'auto', marginBottom: 0 }} />
                                  <span style={{ fontSize: '0.85rem' }}>{lang === 'th' ? 'เลือกซ้ำได้ (สั่งตัวเลือกเดิมหลายครั้ง)' : 'Allow duplicate selection'}</span>
                                </label>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '1.5rem' }}>
                                  {lang === 'th' ? 'ถ้าไม่ติ๊ก = แต่ละตัวเลือกเลือกได้ครั้งเดียว' : 'Unticked = each option selectable once'}
                                </div>
                              </div>
                              {editingItem[categoryProp] && menuItems.filter(m => m.category === editingItem[categoryProp]).length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {lang === 'th' ? 'เลือกรายการที่จะแสดง: (หากไม่ติ๊กเลย จะแสดงทุกเมนูในหมวด)' : 'Select items to show (tick none meaning all shows):'}
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    {menuItems.filter(m => m.category === editingItem[categoryProp]).map(it => (
                                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                        <input type="checkbox" checked={(editingItem[itemsProp] || []).includes(it.id)} onChange={() => handlePopupItemToggle(itemsProp, it.id)} style={{ width: 'auto', margin: 0 }} />
                                        <span style={{ flex: 1 }}>
                                          {it.name}
                                          {/* เมนูนี้มีป๊อปอัพของตัวเอง → ตอนขายจะเด้งป๊อปอัพซ้อนให้เลือกตัวเลือกย่อย */}
                                          {hasOwnPopupSteps(it) && (
                                            <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 700, color: '#16a34a', background: 'rgba(34,197,94,0.15)', borderRadius: 4, padding: '0.05rem 0.35rem' }}>
                                              {lang === 'th' ? 'มีป๊อปอัพซ้อน' : 'nested popup'}
                                            </span>
                                          )}
                                        </span>
                                        {editingItem[repeatProp] !== false && (
                                          <>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{lang === 'th' ? 'max/รายการ:' : 'max/item:'}</span>
                                            <input
                                              type="number" min="0"
                                              value={(editingItem[itemsMaxProp] || {})[it.id] || 0}
                                              onChange={e => setEditingItem({ ...editingItem, [itemsMaxProp]: { ...(editingItem[itemsMaxProp] || {}), [it.id]: parseInt(e.target.value) || 0 } })}
                                              style={{ width: '50px', padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}
                                            />
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: 0 }}>
                      <input type="checkbox" checked={editingItem.hasDining !== false} onChange={e => setEditingItem({ ...editingItem, hasDining: e.target.checked })} style={{ width: 'auto', marginBottom: 0 }} />
                      <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{lang === 'th' ? 'แสดง ทานร้าน/ห่อกลับ' : 'Show Dining Options'}</span>
                    </label>

                    {/* หมายเหตุถึงครัว — รายการที่ให้เลือกตั้งรวมไว้ที่หน้าตั้งค่า ตรงนี้แค่เปิด/ปิดของเมนูนี้ */}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', marginBottom: 0, marginTop: '0.6rem' }}>
                      <input type="checkbox" checked={editingItem.hasNotes !== false} onChange={e => setEditingItem({ ...editingItem, hasNotes: e.target.checked })} style={{ width: 'auto', marginBottom: 0, marginTop: '0.15rem' }} />
                      <span>
                        <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 'bold' }}>{lang === 'th' ? 'ถามหมายเหตุถึงครัว' : 'Ask for a kitchen note'}</span>
                        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {lang === 'th'
                            ? 'เช่น ไม่เผ็ด / ไม่ใส่ผักชี — แก้รายการที่ให้เลือกได้ที่ จัดการหลังบ้าน → ตั้งค่า'
                            : 'e.g. not spicy / no coriander — edit the list under Admin → Settings'}
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              {/* ── BOM / สูตรวัตถุดิบ ──────────────────────────────── */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowBom(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: 'none', border: 'none', color: 'var(--text-main)', cursor: 'pointer',
                    fontWeight: 600, fontSize: '0.9rem', padding: 0, marginBottom: showBom ? '1rem' : 0,
                    width: '100%', textAlign: 'left'
                  }}
                >
                  <FlaskConical size={16} style={{ color: 'var(--accent-hover)' }} />
                  {lang === 'th' ? 'สูตรวัตถุดิบ (BOM)' : 'Bill of Materials (BOM)'}
                  {editingBom.length > 0 && (
                    <span style={{ background: 'rgba(34,197,94,0.18)', color: '#16a34a', padding: '0.1rem 0.45rem', borderRadius: 4, fontSize: '0.73rem', fontWeight: 700 }}>
                      {editingBom.length} รายการ · ฿{bomTotalCost.toFixed(2)}
                    </span>
                  )}
                  <ChevronRight size={14} style={{ marginLeft: 'auto', transform: showBom ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {showBom && (
                  <div>
                    {/* Cost summary mini */}
                    {editingBom.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                        {[
                          { label: 'ต้นทุน/จาน', value: `฿${bomTotalCost.toFixed(2)}`, color: '#ef4444' },
                          { label: 'กำไรขั้นต้น', value: `฿${(parseFloat(editingItem.price || 0) - bomTotalCost).toFixed(2)}`, color: '#22c55e' },
                          {
                            label: 'Margin',
                            value: `${editingItem.price > 0 ? ((parseFloat(editingItem.price) - bomTotalCost) / parseFloat(editingItem.price) * 100).toFixed(1) : '0.0'}%`,
                            color: editingItem.price > 0 && ((parseFloat(editingItem.price) - bomTotalCost) / parseFloat(editingItem.price) * 100) >= 50 ? '#22c55e' : '#d84518'
                          },
                        ].map(c => (
                          <div key={c.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '0.45rem 0.85rem', textAlign: 'center', flex: 1, minWidth: 90 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: c.color }}>{c.value}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.label}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* BOM rows */}
                    {editingBom.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        {editingBom.map((row, idx) => {
                          const rowCost = (parseFloat(row.qty) || 0) * (parseFloat(row.costPerUnit) || 0);
                          return (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 65px 70px auto auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                              {/* Ingredient */}
                              {ingredients.length > 0 ? (
                                <select value={row.ingId || ''} onChange={e => updateBomRow(idx, 'ingId', e.target.value)} style={{ fontSize: '0.83rem' }}>
                                  <option value="">— เลือก —</option>
                                  {ingredients.map(ing => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                                </select>
                              ) : (
                                <input value={row.ingName || ''} onChange={e => updateBomRow(idx, 'ingName', e.target.value)} placeholder="ชื่อวัตถุดิบ" style={{ fontSize: '0.83rem' }} />
                              )}
                              {/* Qty */}
                              <input type="number" min="0" step="any" value={row.qty ?? ''} onChange={e => updateBomRow(idx, 'qty', e.target.value)} placeholder="ปริมาณ" style={{ fontSize: '0.83rem', textAlign: 'center' }} />
                              {/* Unit */}
                              <input value={row.unit || ''} onChange={e => updateBomRow(idx, 'unit', e.target.value)} placeholder="หน่วย" style={{ fontSize: '0.83rem', textAlign: 'center' }} />
                              {/* Cost/unit */}
                              <input type="number" min="0" step="any" value={row.costPerUnit ?? ''} onChange={e => updateBomRow(idx, 'costPerUnit', e.target.value)} placeholder="฿/หน่วย" style={{ fontSize: '0.83rem', textAlign: 'center' }} />
                              {/* Row cost */}
                              <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 700, whiteSpace: 'nowrap' }}>฿{rowCost.toFixed(2)}</span>
                              {/* Delete */}
                              <button type="button" onClick={() => removeBomRow(idx)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.2rem', display: 'flex' }}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                        {/* Column labels */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 65px 70px auto auto', gap: '0.4rem', marginTop: '-0.15rem' }}>
                          {['วัตถุดิบ', 'ปริมาณ', 'หน่วย', '฿/หน่วย', 'ต้นทุน', ''].map((h, i) => (
                            <span key={i} style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: i >= 1 && i <= 4 ? 'center' : 'left' }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {editingBom.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', margin: '0.25rem 0 0.75rem' }}>ยังไม่มีส่วนผสม — กด "เพิ่มวัตถุดิบ" เพื่อตั้งค่า BOM</p>
                    )}

                    <button type="button" className="admin-btn secondary" onClick={addBomRow} style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem' }}>
                      <Plus size={14} /> เพิ่มวัตถุดิบ
                    </button>
                    {ingredients.length === 0 && (
                      <p style={{ color: '#d84518', fontSize: '0.78rem', marginTop: '0.5rem', marginBottom: 0 }}>
                        💡 ยังไม่มีคลังวัตถุดิบ — ไปตั้งค่าที่หน้า <strong>BOM</strong> แท็บ "วัตถุดิบ" ก่อน
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button type="submit" className="admin-btn" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                <Save size={20} /> {lang === 'th' ? 'บันทึกเมนู' : 'Save Menu Item'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMenu;
