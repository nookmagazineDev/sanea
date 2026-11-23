import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { X, ArrowRight, ArrowLeft, Check, Ban } from 'lucide-react';
import MenuImage from './MenuImage';
import { resolvePopupSource, getPriceOptions, hasOwnPopupSteps, categoryDining, itemAsksNotes, NOTE_MAX_LENGTH } from '../utils/popupConfig';
import { TAKEHOME_ALIASES, normName as norm, isChannelPriceName } from '../utils/salePricing';

// ชื่อเมนูในการ์ดป๊อปอัพต้องอยู่บรรทัดเดียวเสมอ — ชื่อยาว ๆ ที่ตัดบรรทัด
// ทำให้การ์ดในแถวเดียวกันสูงไม่เท่ากันและอ่านยาก
// ถ้ายาวเกินความกว้างการ์ด ให้ย่อขนาดตัวอักษรลงทีละนิดจนพอดี (มีเพดานล่างกันเล็กจนอ่านไม่ออก
// ถ้าย่อจนสุดแล้วยังไม่พอ ค่อยตัดด้วย ...)
const FitOneLine = ({ text, className = 'option-name', style, maxRem = 1.05, minRem = 0.7 }) => {
  const ref = useRef(null);
  const [fontRem, setFontRem] = useState(maxRem);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const fit = () => {
      const el = ref.current;
      if (!el || !el.clientWidth) return;
      let size = maxRem;
      el.style.fontSize = `${size}rem`;
      while (size > minRem && el.scrollWidth > el.clientWidth + 1) {
        size = Math.round((size - 0.03) * 100) / 100;
        el.style.fontSize = `${size}rem`;
      }
      setFontRem(size);
    };
    fit();

    // จอหมุน/การ์ดเปลี่ยนความกว้าง ต้องวัดใหม่ — เทียบความกว้างก่อน กันวัดวนเพราะความสูงเปลี่ยน
    if (typeof ResizeObserver === 'undefined') return;
    let lastWidth = node.clientWidth;
    const ro = new ResizeObserver(() => {
      const el = ref.current;
      if (!el || el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [text, maxRem, minRem]);

  return (
    <div
      ref={ref}
      className={className}
      title={typeof text === 'string' ? text : undefined}
      style={{
        ...style,
        fontSize: `${fontRem}rem`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {text}
    </div>
  );
};

const DINING_OPTIONS = [
  { id: 'dine_in', name: 'ทานที่ร้าน', nameEn: 'Dine-in' },
  { id: 'takeaway', name: 'ห่อกลับบ้าน', nameEn: 'Takeaway' }
];

// ความลึกสูงสุดของป๊อปอัพซ้อนป๊อปอัพ — กันการตั้งค่าที่วนหากันเองจนซ้อนไม่รู้จบ
const MAX_POPUP_DEPTH = 3;
// ชื่อราคาที่เป็น "ช่องทางขาย" ไม่ใช่ขนาด/ตัวเลือกของเมนู แยกออกจากขั้นตอนเลือกราคา
// เพราะช่องทางถูกกำหนดจากหัวตะกร้าและปุ่มห่อกลับอยู่แล้ว
const isChannelPrice = (name) => isChannelPriceName(name);

const OrderWizardModal = ({ food, onClose, onConfirm, lang = 'th', liveMenu = [], categories = [], basePrice = 0, askDining = true, depth = 0, ancestorIds = [], hasPriceForCustomerType = () => true, noteOptions = [], allowCustomNote = false, initialState = null, confirmLabel = null, customerView = false }) => {
  // customerView = หน้าลูกค้าสั่งเอง (QR): การ์ดตัวเลือกมีรูปเมนู และไม่โชว์ป้าย "ฟรี ฿0"
  // initialState = ตัวเลือกเดิมที่เคยเลือกไว้ (จาก onConfirm ครั้งก่อน) — ใช้ตอนลูกค้ากด "แก้ไขตัวเลือก" ในตะกร้า
  // เปิดมาแล้วเห็นที่เลือกไว้ครบ แก้เฉพาะจุดแล้วกดถัดไปจนจบได้เลย
  const init = initialState || {};
  const initPopup = (n) => ({ ...((init.popups || {})[n] || {}) });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedPopup1, setSelectedPopup1] = useState(() => initPopup(1));
  const [selectedPopup2, setSelectedPopup2] = useState(() => initPopup(2));
  const [selectedPopup3, setSelectedPopup3] = useState(() => initPopup(3));
  const [selectedPopup4, setSelectedPopup4] = useState(() => initPopup(4));
  const [selectedPopup5, setSelectedPopup5] = useState(() => initPopup(5));
  const [selectedPopup6, setSelectedPopup6] = useState(() => initPopup(6));
  const [selectedDining, setSelectedDining] = useState(() => DINING_OPTIONS.find(o => o.id === init.diningId) || DINING_OPTIONS[0]);
  // ตัวเลือกย่อยของแต่ละครั้งที่เลือก (ป๊อปอัพซ้อนป๊อปอัพ)
  // รูปแบบ: { [popupNum]: { [itemId]: [ { selectedPrice, allPopups }, ... ] } }
  const [subOptions, setSubOptions] = useState(() => init.subOptions || {});
  // เมนูในป๊อปอัพที่กำลังเปิดป๊อปอัพของตัวเองอยู่
  const [nestedPending, setNestedPending] = useState(null);
  // หมายเหตุถึงครัว — ปุ่มที่กดเลือกไว้ (id → true) และข้อความที่ลูกค้าพิมพ์เอง
  const [pickedNotes, setPickedNotes] = useState(() => ({ ...(init.pickedNotes || {}) }));
  const [customNote, setCustomNote] = useState(() => init.customNote || '');

  const allPriceOptions = getPriceOptions(food);
  // ราคาที่ให้เลือกในขั้นตอน "เลือกราคา/ขนาด" = ตัดราคาช่องทางขาย (Takehome/Deli) ออก
  const priceOptions = allPriceOptions.filter(o => !isChannelPrice(o.name));
  const hasMultiplePrices = priceOptions.length > 1;
  // ราคาห่อกลับบ้านของเมนูนี้ (ถ้าตั้งไว้) — ใช้ตอนลูกค้าเลือกห่อกลับ
  const takehomePrice = allPriceOptions.find(o => TAKEHOME_ALIASES.includes(norm(o.name)));

  const [selectedPrice, setSelectedPrice] = useState(() => {
    const opts = priceOptions.length > 0 ? priceOptions : allPriceOptions;
    const prev = init.selectedPrice;
    const kept = prev && opts.find(o => o.name === prev.name && Number(o.price) === Number(prev.price));
    if (kept) return kept;
    const match = opts.find(o => Number(o.price) === Number(basePrice));
    return match || opts[0];
  });

  const categoryConfig = food ? resolvePopupSource(food, categories) : {};
  // หมวดที่ปิดคำถามการรับประทานไว้ (เดิมเช็กว่าเป็นหมวด 'drink' ตรง ๆ)
  const skipDining = categoryConfig.hasDining === false;

  // อ่านค่าตั้งของป๊อปอัพลำดับที่ n จากเมนู (หรือหมวดหมู่ ถ้าเมนูยังไม่ได้ตั้งเอง)
  const resolvePopupConfig = (n) => {
    const slug = categoryConfig[`popup${n}Category`];
    const slugs = slug ? [slug] : [];

    const namesTh = slugs.map(s => categories.find(cat => cat.slug === s)?.name).filter(Boolean).join(', ') || 'ตัวเลือกเพิ่มเติม';
    const namesEn = slugs.map(s => categories.find(cat => cat.slug === s)?.nameEn).filter(Boolean).join(', ') || 'Extra Options';

    let items = liveMenu.filter(m => slugs.includes(m.category));
    const onlyIds = categoryConfig[`popup${n}Items`];
    if (onlyIds && onlyIds.length > 0) {
      items = items.filter(m => onlyIds.includes(m.id));
    }

    const isFree = categoryConfig[`popup${n}Free`] === true;
    // ตัวเลือกที่ยังไม่ได้ตั้งราคาของประเภทการขายที่เลือกอยู่ ยังโชว์ให้เห็นว่ามีอยู่
    // แต่กดเลือกไม่ได้ ยกเว้นป๊อปอัพที่ตั้งเป็นของฟรี — คิด ฿0 อยู่แล้ว ไม่มีทางคีย์ราคาผิด
    const unpricedIds = new Set(
      isFree ? [] : items.filter(m => !hasPriceForCustomerType(m)).map(m => m.id)
    );
    items = items.map(m => ({ ...m, price: isFree ? 0 : m.price }));

    return {
      namesTh,
      namesEn,
      items,
      unpricedIds,
      minSelect: categoryConfig[`popup${n}Min`] || 0,
      maxSelect: categoryConfig[`popup${n}Max`] || 0,
      itemsMaxMap: categoryConfig[`popup${n}ItemsMax`] || {},
      allowRepeat: categoryConfig[`popup${n}AllowRepeat`] !== false,
      isFree,
      // แยกเป็นรายการของตัวเองในบิล/ใบครัว แทนที่จะเป็นตัวเลือกใต้เมนูหลัก
      // ไม่ได้ตั้งค่าไว้ = แยก (ค่าตั้งต้น) ต้องติ๊กออกเองถ้าอยากให้เป็นตัวเลือกห้อยใต้เมนูหลัก
      separate: categoryConfig[`popup${n}Separate`] !== false
    };
  };

  const pop1Config = resolvePopupConfig(1);
  const pop2Config = resolvePopupConfig(2);
  const pop3Config = resolvePopupConfig(3);
  const pop4Config = resolvePopupConfig(4);
  const pop5Config = resolvePopupConfig(5);
  const pop6Config = resolvePopupConfig(6);

  // ── ตารางรวมของแต่ละขั้นตอนป๊อปอัพ (1..6) ─────────────────
  const stepConfigs = { 1: pop1Config, 2: pop2Config, 3: pop3Config, 4: pop4Config, 5: pop5Config, 6: pop6Config };
  const stepQtyMaps = { 1: selectedPopup1, 2: selectedPopup2, 3: selectedPopup3, 4: selectedPopup4, 5: selectedPopup5, 6: selectedPopup6 };
  const stepSetters = { 1: setSelectedPopup1, 2: setSelectedPopup2, 3: setSelectedPopup3, 4: setSelectedPopup4, 5: setSelectedPopup5, 6: setSelectedPopup6 };

  const getQty = (qtyMap, id) => qtyMap[id] || 0;
  const totalQty = (qtyMap) => Object.values(qtyMap).reduce((s, v) => s + v, 0);

  // ตัวเลือกย่อยของเมนูที่เลือกไว้ในขั้นตอนนี้ (แต่ละครั้งที่เลือกเก็บแยกกัน)
  const getSubList = (stepNum, itemId) => ((subOptions[stepNum] || {})[itemId] || []);

  // สรุปชื่อของตัวเลือกย่อย รวมรายการซ้ำเป็นจำนวน เช่น "ชีส ×2"
  const groupSubs = (subs) => {
    const grouped = [];
    subs.forEach(sub => {
      const found = grouped.find(g => g.name === sub.name);
      if (found) found.count += 1;
      else grouped.push({ name: sub.name, nameEn: sub.nameEn || sub.name, count: 1 });
    });
    return grouped;
  };

  const subLabel = (details, useTh = true) => {
    if (!details) return '';
    const parts = [];
    if (details.selectedPrice && details.selectedPrice.name) parts.push(details.selectedPrice.name);
    groupSubs(details.allPopups || []).forEach(g => {
      const name = useTh ? g.name : g.nameEn;
      parts.push(g.count > 1 ? `${name} ×${g.count}` : name);
    });
    return parts.join(', ');
  };

  // เมนูในป๊อปอัพที่ถูกเลือก 1 ครั้ง → รายการหลัก + ตัวเลือกย่อยจากป๊อปอัพซ้อน เรียงต่อกันแบบแบนราบ
  // ชื่อของทุกรายการยังเป็นชื่อเมนูจริง บิล/ใบครัว/รายงานจึงจับคู่ชื่อได้เหมือนเดิม
  // ส่วนความสัมพันธ์ "อยู่ใต้รายการไหน" เก็บไว้ที่ parentPopupId / subPopups
  const buildEntries = (item, details) => {
    if (!details) return [item];
    const subs = details.allPopups || [];
    const chosen = details.selectedPrice;
    const suffix = [chosen && chosen.name ? chosen.name : '', ...subs.map(sub => sub.id)].filter(Boolean).join('+');
    const parentId = suffix ? `${item.id}__${suffix}` : item.id;
    const parent = {
      ...item,
      id: parentId,
      baseId: item.baseId || item.id,
      price: chosen ? (Number(chosen.price) || 0) : (Number(item.price) || 0),
      priceName: chosen ? (chosen.name || '') : (item.priceName || ''),
      selectedPrice: chosen || null,
      subPopups: subs
    };
    const entries = [parent];
    // ชื่อราคา/ขนาดที่เลือก แสดงเป็นบรรทัดตัวเลือก (ราคาถูกคิดไว้ที่รายการหลักแล้ว)
    if (chosen && chosen.name) {
      entries.push({
        id: `${parentId}__price`, name: chosen.name, nameEn: chosen.name, price: 0,
        parentPopupId: parentId, isNestedOption: true, isOptionLabel: true
      });
    }
    subs.forEach(sub => entries.push({ ...sub, parentPopupId: parentId, isNestedOption: true }));
    return entries;
  };

  const expandStep = (stepNum, config, qtyMap) => {
    const result = [];
    config.items.forEach(item => {
      const q = qtyMap[item.id] || 0;
      const picks = getSubList(stepNum, item.id);
      for (let i = 0; i < q; i++) result.push(...buildEntries(item, picks[i]));
    });
    return result;
  };

  // ราคารวมของการเลือก 1 ครั้ง (รายการหลัก + ตัวเลือกย่อย) — ใช้โชว์บนการ์ด
  const instanceTotal = (item, details) =>
    buildEntries(item, details).reduce((sum, entry) => sum + (Number(entry.price) || 0), 0);

  const perItemMaxOf = (config, itemId) => (config.allowRepeat === false ? 1 : ((config.itemsMaxMap || {})[itemId] || 0));

  const canAddMore = (config, qtyMap, itemId) => {
    if (config.maxSelect > 0 && totalQty(qtyMap) >= config.maxSelect) return false;
    const perItemMax = perItemMaxOf(config, itemId);
    if (perItemMax > 0 && getQty(qtyMap, itemId) >= perItemMax) return false;
    return true;
  };

  // กันวนซ้ำไม่รู้จบ: เมนูที่เป็นต้นทางของป๊อปอัพอยู่แล้ว หรือซ้อนลึกเกินไป จะไม่เปิดซ้อนอีก
  const chain = [...ancestorIds, food && food.id].filter(v => v !== undefined && v !== null).map(String);
  const canOpenNested = (item) =>
    depth < MAX_POPUP_DEPTH && hasOwnPopupSteps(item) && !chain.includes(String(item.id));

  // เลือกเมนูในป๊อปอัพ — ถ้าเมนูนั้นมีป๊อปอัพของตัวเอง ให้เปิดป๊อปอัพซ้อนขึ้นมาก่อน
  const handlePick = (stepNum, config, item) => {
    const qtyMap = stepQtyMaps[stepNum];
    if (config.unpricedIds.has(item.id)) return;
    if (!canAddMore(config, qtyMap, item.id)) return;
    if (canOpenNested(item)) {
      // ป๊อปอัพที่ตั้งเป็น "ฟรี" ไม่ควรให้เลือกราคาซ้อนเข้ามา
      const nestedFood = config.isFree ? { ...item, prices: [], price: 0 } : item;
      setNestedPending({ stepNum, item, food: nestedFood });
      return;
    }
    stepSetters[stepNum](prev => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
  };

  // ยืนยันตัวเลือกย่อยจากป๊อปอัพซ้อน = นับเป็นการเลือกเมนูนั้น 1 ครั้ง พร้อมตัวเลือกของครั้งนั้น
  const handleNestedConfirm = (nestedFood, details) => {
    if (!nestedPending) return;
    const { stepNum, item } = nestedPending;
    stepSetters[stepNum](prev => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
    setSubOptions(prev => {
      const stepMap = { ...(prev[stepNum] || {}) };
      stepMap[item.id] = [...(stepMap[item.id] || []), details];
      return { ...prev, [stepNum]: stepMap };
    });
    setNestedPending(null);
  };

  const removeQty = (stepNum, id) => {
    const qtyMap = stepQtyMaps[stepNum];
    const current = getQty(qtyMap, id);
    if (current <= 0) return;
    const next = { ...qtyMap, [id]: current - 1 };
    if (next[id] === 0) delete next[id];
    stepSetters[stepNum](next);
    // ตัดตัวเลือกย่อยของครั้งล่าสุดออกไปด้วย
    setSubOptions(prev => {
      const stepMap = { ...(prev[stepNum] || {}) };
      const list = stepMap[id];
      if (!list || list.length === 0) return prev;
      const trimmed = list.slice(0, -1);
      if (trimmed.length === 0) delete stepMap[id];
      else stepMap[id] = trimmed;
      return { ...prev, [stepNum]: stepMap };
    });
  };

  const clearStep = (stepNum) => {
    stepSetters[stepNum]({});
    setSubOptions(prev => ({ ...prev, [stepNum]: {} }));
  };

  // ข้ามขั้นตอนป๊อปอัพที่ไม่เหลือตัวเลือกให้เลือกแล้ว (เช่นถูกกรองออกตามประเภทการขาย)
  // ไม่งั้นจะติดหน้าเปล่า ๆ และถ้าขั้นนั้นตั้ง "ต้องเลือกอย่างน้อย N" ไว้จะกดต่อไม่ได้เลย
  const stepIsUsable = (n) => categoryConfig[`hasPopup${n}`] === true
    && stepConfigs[n].items.some(m => !stepConfigs[n].unpricedIds.has(m.id));

  // ขั้นตอนหมายเหตุ — โผล่เมื่อเมนูนี้เปิดไว้ และร้านมีอะไรให้เลือกหรือให้พิมพ์เองได้
  // ป๊อปอัพซ้อน (depth > 0) ไม่ถาม เพราะรายการข้างในเป็นตัวเลือกของจานหลักอีกที
  const noteStepUsable = depth === 0
    && itemAsksNotes(categoryConfig)
    && (noteOptions.length > 0 || allowCustomNote);

  const validSteps = [
    hasMultiplePrices ? 'price' : null,
    ...[1, 2, 3, 4, 5, 6].map(n => (stepIsUsable(n) ? n : null)),
    noteStepUsable ? 'notes' : null,
    (askDining && !skipDining) ? 7 : null
  ].filter(s => s !== null);

  const step = validSteps[currentStepIndex] || 1;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === validSteps.length - 1;

  useEffect(() => {
    if (validSteps.length === 0) {
      handleSubmit();
    }
  }, [validSteps.length]);

  if (!food) return null;

  const handleNext = () => {
    const checkStep = (stepNum, config, selected) => {
      if (step === stepNum && config.minSelect > 0 && totalQty(selected) < config.minSelect) {
        alert(lang === 'th' ? `กรุณาเลือกอย่างน้อย ${config.minSelect} รายการในตัวเลือกนี้ครับ` : `Please select at least ${config.minSelect} items.`);
        return false;
      }
      return true;
    };

    if (!checkStep(1, pop1Config, selectedPopup1)) return;
    if (!checkStep(2, pop2Config, selectedPopup2)) return;
    if (!checkStep(3, pop3Config, selectedPopup3)) return;
    if (!checkStep(4, pop4Config, selectedPopup4)) return;
    if (!checkStep(5, pop5Config, selectedPopup5)) return;
    if (!checkStep(6, pop6Config, selectedPopup6)) return;

    if (!isLastStep) setCurrentStepIndex(currentStepIndex + 1);
  };

  const handlePrev = () => {
    if (!isFirstStep) setCurrentStepIndex(currentStepIndex - 1);
  };

  // ตัวเลือกที่อยู่ใต้เมนูหลัก (ป๊อปอัพที่ไม่ได้ตั้งให้แยกรายการ)
  const getExpandedPopups = () => [1, 2, 3, 4, 5, 6]
    .filter(n => !stepConfigs[n].separate)
    .flatMap(n => expandStep(n, stepConfigs[n], stepQtyMaps[n]));

  // ป๊อปอัพที่ตั้งไว้ว่า "แยกเป็นรายการต่างหาก" — ออกเป็นรายการของตัวเองในบิล/ใบครัว
  // รายการหลักคือตัวเมนูที่เลือก ส่วนตัวเลือกย่อยของมัน (จากป๊อปอัพซ้อน) ห้อยไว้ใต้รายการนั้น
  // ถ้าป๊อปอัพซ้อนข้างในก็ตั้งให้แยกไว้ด้วย ต้องดันรายการนั้นขึ้นมาเป็นรายการของบิลเหมือนกัน
  const getSeparateItems = () => {
    const rows = [];
    [1, 2, 3, 4, 5, 6].forEach(n => {
      const config = stepConfigs[n];
      const qtyMap = stepQtyMaps[n];
      config.items.forEach(item => {
        const q = qtyMap[item.id] || 0;
        const picks = getSubList(n, item.id);
        for (let i = 0; i < q; i++) {
          const details = picks[i];
          if (config.separate) {
            const entries = buildEntries(item, details);
            rows.push({ food: entries[0], options: entries.slice(1) });
          }
          if (details && Array.isArray(details.separateItems)) rows.push(...details.separateItems);
        }
      });
    });
    return rows;
  };

  const diningAsked = validSteps.indexOf(7) !== -1;
  const isTakeaway = diningAsked && selectedDining.id === 'takeaway';

  // ราคาฐานที่จะใช้จริง — เลือกห่อกลับบ้านแล้วเมนูมีราคา Takehome ตั้งไว้ ให้คิดราคานั้นแทน
  const effectivePrice = () => {
    if (isTakeaway && takehomePrice) return takehomePrice;
    if (hasMultiplePrices) return selectedPrice;
    return null; // ไม่ระบุ = ใช้ราคาตามที่หน้าขายส่งมา (basePrice)
  };

  const currentTotal = () => {
    const chosen = effectivePrice();
    let total = chosen ? (Number(chosen.price) || 0) : (Number(basePrice) || Number(food?.price) || 0);
    getExpandedPopups().forEach(a => { total += Number(a.price) || 0; });
    // รายการที่แยกออกไปยังอยู่ในบิลเดียวกัน ยอดรวมชั่วคราวจึงต้องนับด้วย
    getSeparateItems().forEach(row => {
      total += Number(row.food.price) || 0;
      row.options.forEach(o => { total += Number(o.price) || 0; });
    });
    return total;
  };

  // หมายเหตุที่เลือก + ที่พิมพ์เอง รวมเป็นข้อความเดียว เก็บลงช่อง note ของรายการในตะกร้า
  // (ช่องเดียวกับที่พนักงานพิมพ์เองได้ในตะกร้า บิลกับใบครัวจึงแสดงได้อยู่แล้ว)
  const buildNote = () => {
    const parts = noteOptions
      .filter(o => pickedNotes[o.id])
      .map(o => (lang === 'th' ? o.name : (o.nameEn || o.name)));
    const typed = allowCustomNote ? customNote.trim() : '';
    if (typed) parts.push(typed);
    return parts.join(', ');
  };

  const handleSubmit = () => {
    onConfirm(food, {
      selectedPrice: effectivePrice(),
      allPopups: getExpandedPopups(),
      separateItems: getSeparateItems(),
      note: buildNote(),
      dining: skipDining ? categoryDining(food, categories) : selectedDining
    }, {
      // ตัวเลือกดิบที่เลือกไว้ — ส่งกลับมาเป็น initialState เพื่อเปิดแก้ไขทีหลังได้
      selectedPrice: hasMultiplePrices ? selectedPrice : null,
      popups: { 1: selectedPopup1, 2: selectedPopup2, 3: selectedPopup3, 4: selectedPopup4, 5: selectedPopup5, 6: selectedPopup6 },
      subOptions,
      pickedNotes,
      customNote,
      diningId: selectedDining.id,
      stepCount: validSteps.length
    });
  };

  const renderPopupStep = (stepNum, config, qtyMap) => {
    const total = totalQty(qtyMap);
    const atMax = config.maxSelect > 0 && total >= config.maxSelect;
    // ตัวนับ "เลือกแล้ว x/สูงสุด" — แดงเมื่อยังไม่ถึงขั้นต่ำ, ส้มเมื่อเลือกครบแล้ว, เทาตามปกติ
    const belowMin = config.minSelect > 0 && total < config.minSelect;
    const counterText = `${lang === 'th' ? 'เลือกแล้ว' : 'Selected'} ${total}${config.maxSelect > 0 ? `/${config.maxSelect}` : ''}`;
    const counterColors = belowMin
      ? { background: '#fee2e2', color: '#b91c1c' }
      : atMax ? { background: '#fbe0e4', color: '#a50d25' } : { background: '#f1f1f1', color: '#454545' };
    const skipOn = total === 0;
    return (
      <div className="wizard-step">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <h3 className="step-title" style={{ color: '#141414', fontWeight: '800', margin: 0 }}>{lang === 'th' ? `เลือก ${config.namesTh}` : `Select ${config.namesEn}`}</h3>
          <span style={{ ...counterColors, flexShrink: 0, whiteSpace: 'nowrap', borderRadius: '999px', padding: '0.2rem 0.7rem', fontSize: '0.85rem', fontWeight: 800 }}>
            {counterText}
          </span>
        </div>
        <div className="options-grid">
          {config.items.length > 0 ? config.items.map(addon => {
            const qty = getQty(qtyMap, addon.id);
            const perItemMax = perItemMaxOf(config, addon.id);
            const itemAtMax = perItemMax > 0 && qty >= perItemMax;
            // ยังไม่ได้ตั้งราคาของประเภทการขายนี้ = เห็นได้ แต่กดเลือกไม่ได้
            const unpriced = config.unpricedIds.has(addon.id);
            const cardDisabled = unpriced || (atMax && qty === 0) || itemAtMax;
            const isSelected = qty > 0;
            // เมนูตัวเลือกที่มีป๊อปอัพของตัวเอง = กดแล้วเปิดป๊อปอัพซ้อนให้เลือกต่อ
            const nested = canOpenNested(addon);
            const addonDesc = lang === 'th'
              ? addon.description
              : (addon.descriptionEn || addon.description);
            const picks = getSubList(stepNum, addon.id);
            return (
              <div
                key={addon.id}
                className={`option-card ${isSelected ? 'selected' : ''}`}
                style={{
                  position: 'relative',
                  cursor: unpriced ? 'not-allowed' : (cardDisabled ? 'default' : 'pointer'),
                  opacity: cardDisabled ? 0.5 : 1,
                  background: isSelected ? '#fdf2f4' : '#ffffff',
                  border: `2px solid ${isSelected ? '#c8102e' : '#d0d0d0'}`,
                  ...(customerView ? { padding: '0.55rem 0.55rem 0.7rem' } : {})
                }}
                title={unpriced
                  ? (lang === 'th' ? 'ยังไม่ได้ตั้งราคาสำหรับประเภทการขายนี้' : 'No price set for this sale type')
                  : undefined}
                onClick={() => handlePick(stepNum, config, addon)}
              >
                {qty > 0 && (
                  <div
                    style={{
                      position: 'absolute', top: '-10px', right: '-10px',
                      display: 'flex', alignItems: 'center',
                      background: '#141414',
                      borderRadius: '20px', overflow: 'hidden',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                      zIndex: 10, border: '1px solid #d0d0d0'
                    }}
                  >
                    <div
                      onClick={e => { e.stopPropagation(); removeQty(stepNum, addon.id); }}
                      style={{
                        background: '#ef4444', color: 'white',
                        width: '22px', height: '22px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >−</div>
                    <div style={{
                      color: 'white', fontWeight: 'bold', fontSize: '0.8rem',
                      padding: '0 6px', minWidth: '18px', textAlign: 'center'
                    }}>{qty}</div>
                  </div>
                )}
                {customerView && (
                  <MenuImage
                    food={addon}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: '9px', background: '#f1f1f1', marginBottom: '0.45rem' }}
                  />
                )}
                <FitOneLine
                  text={lang === 'th' ? addon.name : addon.nameEn}
                  style={{ color: '#141414', fontWeight: '700', marginBottom: nested ? '0.25rem' : undefined }}
                />
                {/* ป้ายบอกว่ามีตัวเลือกย่อย — แยกบรรทัดของตัวเอง ไม่แย่งที่ชื่อเมนู */}
                {nested && (
                  <div style={{ marginBottom: '0.4rem' }}>
                    <span style={{ display: 'inline-block', fontSize: '0.65rem', fontWeight: 800, color: '#a50d25', background: '#fbe0e4', borderRadius: '999px', padding: '0.1rem 0.4rem', whiteSpace: 'nowrap' }}>
                      {lang === 'th' ? 'มีตัวเลือกย่อย' : 'has options'}
                    </span>
                  </div>
                )}
                {/* รายละเอียดเมนู — คนละบรรทัดกับชื่อ ตัวเล็กกว่า */}
                {addonDesc && !(customerView && addonDesc.trim() === String(addon.name || '').trim()) && <div className="option-desc">{addonDesc}</div>}
                {/* ตัวเลือกย่อยที่เลือกไว้ของแต่ละครั้ง */}
                {picks.length > 0 && (
                  <div style={{ marginTop: '2px', textAlign: 'left' }}>
                    {picks.map((details, pi) => {
                      const label = subLabel(details, lang === 'th');
                      return (
                        <div key={pi} style={{ fontSize: '0.7rem', color: '#454545', fontWeight: 600, lineHeight: 1.35 }}>
                          ↳ {label || (lang === 'th' ? 'ไม่มีตัวเลือกเพิ่ม' : 'no extras')}
                          <span style={{ color: '#c8102e', fontWeight: 800, marginLeft: '0.25rem' }}>
                            ฿{instanceTotal(addon, details).toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {unpriced ? (
                  <div className="option-price" style={{ color: '#7a7a7a', fontWeight: '800', fontSize: '0.78rem' }}>
                    {lang === 'th' ? 'ยังไม่ตั้งราคา' : 'No price set'}
                  </div>
                ) : (
                <div className="option-price" style={{ color: addon.price > 0 ? '#c8102e' : '#16a34a', fontWeight: '800' }}>
                  {/* ป๊อปอัพที่แยกรายการ = เป็นจานของตัวเอง จึงโชว์ราคาเต็มของรายการนั้น (ฟรีก็เป็น ฿0)
                      ส่วนป๊อปอัพที่เป็นตัวเลือกใต้เมนูหลัก ยังโชว์เป็นส่วนที่บวกเพิ่ม (+฿) เหมือนเดิม */}
                  {config.separate
                    ? (addon.price > 0 ? `฿${addon.price}` : (customerView ? '' : (lang === 'th' ? 'ฟรี ฿0' : 'Free ฿0')))
                    : (addon.price > 0 ? `+฿${addon.price}` : '')}
                  {nested && addon.price <= 0 && picks.length === 0 && !config.separate ? (lang === 'th' ? 'กดเพื่อเลือก' : 'tap to choose') : ''}
                </div>
                )}
              </div>
            );
          }) : (
            <p style={{ color: '#5a5a5a', gridColumn: '1 / -1', textAlign: 'center', fontWeight: '600' }}>
              {lang === 'th' ? 'ไม่มีตัวเลือกในหมวดนี้ กดถัดไปได้เลย' : 'No items found. Please click Next.'}
            </p>
          )}
        </div>
        {/* "ไม่รับ" อยู่ล่างสุดเสมอ — เห็นเมนูก่อน แล้วค่อยเห็นทางข้าม */}
        {config.minSelect === 0 && config.items.length > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#7a7a7a', fontSize: '0.75rem', fontWeight: 700, margin: '1rem 0 0.6rem' }}>
              <div style={{ flex: 1, height: 1, background: '#e4e4e4' }} />
              {lang === 'th' ? 'หรือ' : 'or'}
              <div style={{ flex: 1, height: 1, background: '#e4e4e4' }} />
            </div>
            <button
              type="button"
              role="radio"
              aria-checked={skipOn}
              onClick={() => clearStep(stepNum)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left',
                fontFamily: 'inherit', cursor: 'pointer', borderRadius: '14px', padding: '0.75rem 0.9rem',
                background: skipOn ? '#fdf2f4' : '#ffffff',
                border: `2px ${skipOn ? 'solid' : 'dashed'} ${skipOn ? '#c8102e' : '#d0d0d0'}`
              }}
            >
              <span aria-hidden="true" style={{
                width: 34, height: 34, flexShrink: 0, borderRadius: '50%',
                background: skipOn ? '#fbe0e4' : '#f1f1f1', color: skipOn ? '#a50d25' : '#5a5a5a',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Ban size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', color: '#141414', fontWeight: 800, fontSize: '1rem' }}>
                  {lang === 'th' ? 'ไม่รับ' : 'No thanks'}
                </span>
                <span style={{ display: 'block', color: '#5a5a5a', fontSize: '0.78rem', fontWeight: 600 }}>
                  {lang === 'th' ? 'ข้ามขั้นตอนนี้ ไม่เพิ่มรายการ' : 'Skip this step, add nothing'}
                </span>
              </span>
              <span aria-hidden="true" style={{
                width: 22, height: 22, flexShrink: 0, borderRadius: '50%', boxSizing: 'border-box',
                border: skipOn ? '6px solid #c8102e' : '2px solid #d0d0d0', background: '#ffffff'
              }} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 + depth * 10 }}>
      <div className="modal-content wizard-modal" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', color: '#141414', borderRadius: '20px', border: '1px solid #e4e4e4', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
        <div className="modal-header">
          <div className="wizard-progress">
            <span style={{ color: '#454545', fontWeight: 700 }}>{lang === 'th' ? `ขั้นตอนที่ ${currentStepIndex + 1}/${validSteps.length}` : `Step ${currentStepIndex + 1}/${validSteps.length}`}</span>
            <div className="progress-bar" style={{ background: '#e4e4e4' }}>
              <div className="progress-fill" style={{ width: `${((currentStepIndex + 1) / validSteps.length) * 100}%`, background: '#c8102e' }}></div>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={24} color="#141414" />
          </button>
        </div>

        <div className="wizard-body">
          {step === 'price' && (
            <div className="wizard-step">
              <h3 className="step-title" style={{ color: '#141414', fontWeight: '800' }}>{lang === 'th' ? 'เลือกราคา / ขนาด' : 'Select Price / Size'}</h3>
              <p className="step-desc" style={{ color: '#454545', fontWeight: '600' }}>
                {lang === 'th' ? 'กรุณาเลือกตัวเลือกราคาสำหรับเมนูนี้' : 'Please select a price option for this item'}
              </p>
              <div className="options-grid cols-2">
                {priceOptions.map((opt, idx) => {
                  const isSel = selectedPrice?.name === opt.name && Number(selectedPrice?.price) === Number(opt.price);
                  return (
                    <div
                      key={idx}
                      className={`option-card large ${isSel ? 'selected' : ''}`}
                      onClick={() => setSelectedPrice(opt)}
                      style={{ cursor: 'pointer', background: isSel ? '#fdf2f4' : '#ffffff', border: `2px solid ${isSel ? '#c8102e' : '#d0d0d0'}` }}
                    >
                      <div>
                        <FitOneLine text={opt.name || (lang === 'th' ? 'ราคาปกติ' : 'Regular')} style={{ color: '#141414', fontWeight: '700' }} />
                        <div className="option-price" style={{ color: '#c8102e', fontWeight: '800', fontSize: '1.1rem', marginTop: '4px' }}>
                          ฿{Number(opt.price).toLocaleString()}
                        </div>
                      </div>
                      <div className="radio-circle" style={{ borderColor: isSel ? '#c8102e' : '#d0d0d0' }}>
                        {isSel && <div className="radio-fill" style={{ background: '#c8102e' }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && renderPopupStep(1, pop1Config, selectedPopup1)}
          {step === 2 && renderPopupStep(2, pop2Config, selectedPopup2)}
          {step === 3 && renderPopupStep(3, pop3Config, selectedPopup3)}
          {step === 4 && renderPopupStep(4, pop4Config, selectedPopup4)}
          {step === 5 && renderPopupStep(5, pop5Config, selectedPopup5)}
          {step === 6 && renderPopupStep(6, pop6Config, selectedPopup6)}

          {step === 'notes' && (() => {
            const pickedCount = noteOptions.filter(o => pickedNotes[o.id]).length;
            return (
              <div className="wizard-step">
                <h3 className="step-title" style={{ color: '#141414', fontWeight: '800' }}>
                  {lang === 'th' ? 'หมายเหตุถึงครัว' : 'Note for the kitchen'}
                </h3>
                <p className="step-desc" style={{ color: '#454545', fontWeight: '600' }}>
                  {lang === 'th'
                    ? `ติ๊กได้หลายข้อ หรือข้ามไปก็ได้ — เลือกแล้ว ${pickedCount} ข้อ`
                    : `Tick as many as you like, or skip — ${pickedCount} selected`}
                </p>

                {/* แบบ checkbox: แถวละข้อเต็มความกว้าง แตะตรงไหนของแถวก็ติ๊ก/เอาออกได้ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {noteOptions.map(o => {
                    const on = !!pickedNotes[o.id];
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setPickedNotes(prev => {
                          const next = { ...prev };
                          if (next[o.id]) delete next[o.id]; else next[o.id] = true;
                          return next;
                        })}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', textAlign: 'left',
                          fontFamily: 'inherit', fontSize: '1rem', fontWeight: 700, lineHeight: 1.3,
                          color: '#141414', background: on ? '#fdf2f4' : '#ffffff',
                          border: `2px solid ${on ? '#c8102e' : '#d0d0d0'}`,
                          borderRadius: '12px', padding: '0.75rem 0.9rem', cursor: 'pointer'
                        }}
                      >
                        <span aria-hidden="true" style={{
                          width: 22, height: 22, flexShrink: 0, borderRadius: 6,
                          border: `2px solid ${on ? '#c8102e' : '#7a7a7a'}`, background: on ? '#c8102e' : '#ffffff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          {on && <Check size={15} color="#ffffff" strokeWidth={3.5} />}
                        </span>
                        {lang === 'th' ? o.name : (o.nameEn || o.name)}
                      </button>
                    );
                  })}
                </div>

                {allowCustomNote && (
                  <div style={{ marginTop: noteOptions.length > 0 ? '1.1rem' : 0 }}>
                    <label
                      htmlFor="wizard-custom-note"
                      style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#454545', marginBottom: '0.4rem' }}
                    >
                      {lang === 'th' ? 'พิมพ์หมายเหตุเอง' : 'Type your own note'}
                    </label>
                    <textarea
                      id="wizard-custom-note"
                      value={customNote}
                      maxLength={NOTE_MAX_LENGTH}
                      onChange={e => setCustomNote(e.target.value)}
                      placeholder={lang === 'th'
                        ? 'เช่น แพ้กุ้ง ไม่ใส่เลย / ขอข้าวเยอะหน่อย'
                        : 'e.g. shrimp allergy / extra rice please'}
                      style={{
                        width: '100%', boxSizing: 'border-box', minHeight: '62px', resize: 'vertical',
                        padding: '0.7rem 0.75rem', borderRadius: '10px', border: '2px solid #d0d0d0',
                        background: '#ffffff', color: '#141414', fontFamily: 'inherit', fontSize: '0.95rem'
                      }}
                    />
                    <div style={{ fontSize: '0.76rem', color: '#5a5a5a', textAlign: 'right', marginTop: '0.3rem', fontVariantNumeric: 'tabular-nums' }}>
                      {customNote.length} / {NOTE_MAX_LENGTH}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {step === 7 && (
            <div className="wizard-step">
              <h3 className="step-title" style={{ color: '#141414', fontWeight: '800' }}>{lang === 'th' ? 'การรับประทาน' : 'Dining Option'}</h3>
              <div className="options-grid cols-2">
                {DINING_OPTIONS.map(option => {
                  // ราคาที่จะถูกใช้จริงถ้าเลือกตัวเลือกนี้ — ห่อกลับบ้านจะสลับไปใช้ราคา Takehome
                  const optPrice = (option.id === 'takeaway' && takehomePrice)
                    ? Number(takehomePrice.price) || 0
                    : (hasMultiplePrices ? (Number(selectedPrice?.price) || 0) : (Number(basePrice) || Number(food?.price) || 0));
                  return (
                  <div
                    key={option.id}
                    className={`option-card large ${selectedDining.id === option.id ? 'selected' : ''}`}
                    onClick={() => setSelectedDining(option)}
                    style={{ background: selectedDining.id === option.id ? '#fdf2f4' : '#ffffff', border: `2px solid ${selectedDining.id === option.id ? '#c8102e' : '#d0d0d0'}` }}
                  >
                    <div>
                    <FitOneLine text={lang === 'th' ? option.name : option.nameEn} style={{ color: '#141414', fontWeight: '700' }} />
                    <div className="option-price" style={{ color: '#c8102e', fontWeight: 800, marginTop: '4px' }}>
                      ฿{optPrice.toLocaleString()}
                      {option.id === 'takeaway' && takehomePrice && (
                        <span style={{ marginLeft: '0.35rem', fontSize: '0.72rem', fontWeight: 700, color: '#a50d25' }}>
                          ({lang === 'th' ? 'ราคาห่อกลับ' : 'takeaway price'})
                        </span>
                      )}
                    </div>
                    </div>
                    <div className="radio-circle" style={{ borderColor: selectedDining.id === option.id ? '#c8102e' : '#d0d0d0' }}>
                      {selectedDining.id === option.id && <div className="radio-fill" style={{ background: '#c8102e' }} />}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="wizard-footer" style={{ borderTop: '1px solid #e4e4e4', background: '#f8f8f8' }}>
          {!isFirstStep ? (
            <button className="nav-btn prev" onClick={handlePrev} style={{ color: '#141414', background: '#ffffff', border: '1px solid #d0d0d0', fontWeight: '700' }}>
              <ArrowLeft size={20} /> {lang === 'th' ? 'ย้อนกลับ' : 'Back'}
            </button>
          ) : <div></div>}

          {!isLastStep ? (
            <button className="nav-btn next" onClick={handleNext} style={{ background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#ffffff', fontWeight: '800' }}>
              {(() => {
                // ขั้นไม่บังคับที่ยังไม่เลือกอะไร = ปุ่มบอกชัดว่ากดแล้วคือข้าม
                const cfg = stepConfigs[step];
                const skipping = cfg && cfg.minSelect === 0 && cfg.items.length > 0 && totalQty(stepQtyMaps[step]) === 0;
                if (lang === 'th') return skipping ? `ข้าม ไปต่อ (฿${currentTotal()})` : `ถัดไป (฿${currentTotal()})`;
                return skipping ? `Skip (฿${currentTotal()})` : `Next (฿${currentTotal()})`;
              })()} <ArrowRight size={20} />
            </button>
          ) : (
            <button className="nav-btn confirm" onClick={handleSubmit} style={{ background: 'linear-gradient(135deg, #c8102e 0%, #a50d25 100%)', color: '#ffffff', fontWeight: '800' }}>
              {confirmLabel
                ? `${confirmLabel} (฿${currentTotal()})`
                : (lang === 'th' ? `ยืนยันและเพิ่ม (฿${currentTotal()})` : `Confirm & Add (฿${currentTotal()})`)} <Check size={20} />
            </button>
          )}
        </div>
      </div>
    </div>

    {/* ป๊อปอัพซ้อน — เมนูที่เลือกในป๊อปอัพนี้มีป๊อปอัพของตัวเอง */}
    {nestedPending && (
      <OrderWizardModal
        food={nestedPending.food}
        lang={lang}
        liveMenu={liveMenu}
        categories={categories}
        basePrice={Number(nestedPending.food.price) || 0}
        askDining={false}
        depth={depth + 1}
        ancestorIds={chain}
        hasPriceForCustomerType={hasPriceForCustomerType}
        customerView={customerView}
        onClose={() => setNestedPending(null)}
        onConfirm={handleNestedConfirm}
      />
    )}
    </>
  );
};

export default OrderWizardModal;
