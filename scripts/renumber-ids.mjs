// เปลี่ยนรหัสเมนูและหมวดหมู่ให้เป็นรูปแบบ SN + เลข 5 หลัก แล้วไล่แก้ทุกที่ที่อ้างถึงรหัสนั้น
//
//   node --env-file=.env scripts/renumber-ids.mjs           → ดูตารางรหัสเก่า→ใหม่ ไม่เขียนอะไร
//   node --env-file=.env scripts/renumber-ids.mjs --write    → เปลี่ยนจริง (ทำในทรานแซกชันเดียว)
//
// รหัสที่เป็นรูปแบบ SN อยู่แล้วจะถูกคงไว้ ตัวที่เหลือจะได้เลขต่อจากเลขสูงสุดที่มีอยู่
// จึงรันซ้ำได้ ของเดิมไม่ขยับ
//
// ที่ที่ถูกแก้ตามไปด้วย:
//   Categories : slug, popupNCategory, popupNItems, popupNItemsMax (คีย์)
//   Menu       : id, category, categories[], bundledItems[], popupConfig{popupNCategory,popupNItems,popupNItemsMax}
//   Bom        : menuId
//   StockOut   : menuId
//   Discounts  : categories[]
//
// ออเดอร์เก่า (Orders / TableOrders) เก็บ "ชื่อเมนู" ไม่ได้เก็บรหัส จึงไม่ได้รับผลกระทบ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction, insertRows, getPool, explainConnectError } from '../api/_lib/db.js';
import { formatId, isHlId, idNumber } from '../api/_lib/ids.js';
import { CATEGORY_SPEC } from '../api/_lib/rows.js';

const WRITE = process.argv.includes('--write');
const here = path.dirname(fileURLToPath(import.meta.url));
const MAP_FILE = path.join(here, '..', 'db', 'id-map.json');

const CATEGORY_COLS = Object.keys(CATEGORY_SPEC);
// branches (ขายเฉพาะบางสาขา) / sortOrder (ลำดับการแสดง) ต้องอยู่ในรายการด้วย ไม่งั้นเขียนตารางใหม่แล้วค่าหาย
const MENU_COLS = ['id','category','name','nameEn','description','descriptionEn','price','image','isActive','bundledItems','popupConfig','prices','categories','printerId','branches','sortOrder'];
const POPUP_NUMS = [1, 2, 3, 4, 5, 6];

// ── ตัวช่วยอ่าน/เขียนช่องที่เก็บ JSON เป็นข้อความ ──
const parseJson = (raw, fallback) => {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
};
const remapList = (raw, map) => {
  const list = parseJson(raw, null);
  if (!Array.isArray(list)) return raw;
  return JSON.stringify(list.map(v => map.get(String(v)) ?? v));
};
const remapKeys = (raw, map) => {
  const obj = parseJson(raw, null);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return raw;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[map.get(String(k)) ?? k] = v;
  return JSON.stringify(out);
};
const remapOne = (value, map) => (value === null || value === undefined || value === '' ? value : (map.get(String(value)) ?? value));

// popupConfig ของเมนูเก็บชุดเดียวกับที่อยู่ในหมวดหมู่ แต่ยัดรวมอยู่ใน JSON ก้อนเดียว
const remapPopupConfig = (raw, catMap, menuMap) => {
  const cfg = parseJson(raw, null);
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return raw;
  for (const n of POPUP_NUMS) {
    if (cfg[`popup${n}Category`]) cfg[`popup${n}Category`] = remapOne(cfg[`popup${n}Category`], catMap);
    if (Array.isArray(cfg[`popup${n}Items`])) cfg[`popup${n}Items`] = cfg[`popup${n}Items`].map(v => menuMap.get(String(v)) ?? v);
    const max = cfg[`popup${n}ItemsMax`];
    if (max && typeof max === 'object' && !Array.isArray(max)) {
      const out = {};
      for (const [k, v] of Object.entries(max)) out[menuMap.get(String(k)) ?? k] = v;
      cfg[`popup${n}ItemsMax`] = out;
    }
  }
  return JSON.stringify(cfg);
};

// ── สร้างตารางรหัสเก่า→ใหม่ ──
// หมวดหมู่มาก่อนเมนู ทั้งคู่ใช้ชุดเลขเดียวกัน รหัสหนึ่งตัวจึงไม่ซ้ำข้ามตาราง
function buildMap(categories, menus) {
  const used = [...categories.map(c => c.slug), ...menus.map(m => m.id)].filter(isHlId).map(idNumber);
  let next = used.length ? Math.max(...used) + 1 : 1;
  const take = () => formatId(next++);

  const catMap = new Map();
  for (const c of categories) {
    const old = String(c.slug);
    catMap.set(old, isHlId(old) ? old : take());
  }
  const menuMap = new Map();
  for (const m of menus) {
    const old = String(m.id);
    menuMap.set(old, isHlId(old) ? old : take());
  }
  return { catMap, menuMap };
}

const run = async () => {
  const [catRes, menuRes] = await Promise.all([
    query(`SELECT ${CATEGORY_COLS.map(c => `[${c}]`).join(', ')} FROM dbo.Categories ORDER BY Seq ASC`),
    query(`SELECT ${MENU_COLS.map(c => `[${c}]`).join(', ')} FROM dbo.Menu ORDER BY Seq ASC`)
  ]);
  const categories = catRes.recordset;
  const menus = menuRes.recordset;

  if (categories.length === 0 && menus.length === 0) {
    console.log('ไม่มีข้อมูลเมนูหรือหมวดหมู่ในฐานข้อมูล — ย้ายข้อมูลจากชีทก่อน (npm run sql:migrate -- --write)');
    return;
  }

  const { catMap, menuMap } = buildMap(categories, menus);
  const changedCats  = categories.filter(c => catMap.get(String(c.slug)) !== String(c.slug));
  const changedMenus = menus.filter(m => menuMap.get(String(m.id)) !== String(m.id));

  console.log(`\n── หมวดหมู่ (${categories.length} รายการ, เปลี่ยนรหัส ${changedCats.length}) ──`);
  for (const c of categories) {
    const to = catMap.get(String(c.slug));
    console.log(`  ${String(c.slug).padEnd(22)} → ${to}   ${c.name || ''}`);
  }
  console.log(`\n── เมนู (${menus.length} รายการ, เปลี่ยนรหัส ${changedMenus.length}) ──`);
  for (const m of menus) {
    const to = menuMap.get(String(m.id));
    console.log(`  ${String(m.id).padEnd(22)} → ${to}   ${m.name || ''}`);
  }

  if (!WRITE) {
    console.log('\n— โหมดดูอย่างเดียว ยังไม่เขียนอะไร (ใส่ --write เพื่อเปลี่ยนจริง) —');
    return;
  }

  // เขียนทั้งหมดในทรานแซกชันเดียว ถ้าพลาดกลางทางจะถอยกลับให้หมด ไม่มีสภาพครึ่ง ๆ กลาง ๆ
  await withTransaction(async (runner) => {
    // หมวดหมู่กับเมนูเขียนใหม่ทั้งตาราง เพราะรหัสเป็นคีย์หลัก การอัปเดตทีละแถวอาจชนรหัสที่ยังไม่ได้ย้าย
    // (ลำดับแถวเดิมยังอยู่ เพราะใส่กลับเข้าไปตามลำดับเดิม)
    // โค้ดหน้าขายเคยเช็กตรง ๆ ว่าหมวดชื่อ 'drink' เพื่อข้ามคำถาม "ทานที่ร้าน/ห่อกลับบ้าน"
    // ตอนนี้ย้ายไปอ่านจากค่า hasDining แทน หมวดเครื่องดื่มเดิมจึงต้องถูกตั้ง hasDining = false
    // ไม่งั้นพอเปลี่ยนรหัสแล้วสั่งเครื่องดื่มจะเด้งถามการรับประทานขึ้นมาใหม่
    const drinkLike = (slug) => /^drink/i.test(String(slug || ''));
    const carriedOver = categories.filter(c => drinkLike(c.slug));
    if (carriedOver.length > 0) {
      console.log(`\n  ตั้ง hasDining = false ให้หมวดเครื่องดื่มเดิม: ${carriedOver.map(c => `${c.slug} (${c.name || ''})`).join(', ')}`);
    }

    const catRows = categories.map(c => CATEGORY_COLS.map(col => {
      if (col === 'slug') return catMap.get(String(c.slug));
      if (col === 'hasDining' && drinkLike(c.slug)) return 0;
      if (/^popup[1-6]Category$/.test(col)) return remapOne(c[col], catMap);
      if (/^popup[1-6]Items$/.test(col))    return remapList(c[col], menuMap);
      if (/^popup[1-6]ItemsMax$/.test(col)) return remapKeys(c[col], menuMap);
      return c[col];
    }));
    await runner('DELETE FROM dbo.Categories');
    await insertRows('Categories', CATEGORY_COLS, catRows, runner);

    const menuRows = menus.map(m => MENU_COLS.map(col => {
      if (col === 'id')           return menuMap.get(String(m.id));
      if (col === 'category')     return remapOne(m.category, catMap);
      if (col === 'categories')   return remapList(m.categories, catMap);
      if (col === 'bundledItems') return remapList(m.bundledItems, menuMap);
      if (col === 'popupConfig')  return remapPopupConfig(m.popupConfig, catMap, menuMap);
      return m[col];
    }));
    await runner('DELETE FROM dbo.Menu');
    await insertRows('Menu', MENU_COLS, menuRows, runner);

    // ตารางที่อ้างถึงรหัสเมนู — อัปเดตเฉพาะแถวที่รหัสเปลี่ยนจริง
    for (const [table, column] of [['Bom', 'menuId'], ['StockOut', 'menuId'], ['MenuBranch', 'menuId']]) {
      let touched = 0;
      for (const [oldId, newId] of menuMap) {
        if (oldId === newId) continue;
        const res = await runner(`UPDATE dbo.${table} SET ${column} = @newId WHERE ${column} = @oldId`, { newId, oldId });
        touched += res.rowsAffected[0];
      }
      console.log(`  ${table}.${column}: แก้ ${touched} แถว`);
    }

    // ส่วนลดผูกกับหมวดหมู่เป็นรายการ JSON
    const discounts = await runner('SELECT RowId, categories FROM dbo.Discounts');
    let discountTouched = 0;
    for (const row of discounts.recordset) {
      const mapped = remapList(row.categories, catMap);
      if (mapped === row.categories) continue;
      await runner('UPDATE dbo.Discounts SET categories = @categories WHERE RowId = @rowId', { categories: mapped, rowId: row.RowId });
      discountTouched++;
    }
    console.log(`  Discounts.categories: แก้ ${discountTouched} แถว`);

    // ปริ้นเตอร์ครัว/บาร์ผูกกับหมวดอาหารที่พิมพ์เป็นรายการ JSON เหมือนส่วนลด
    const printers = await runner('SELECT id, categories FROM dbo.Printers');
    let printerTouched = 0;
    for (const row of printers.recordset) {
      const mapped = remapList(row.categories, catMap);
      if (mapped === row.categories) continue;
      await runner('UPDATE dbo.Printers SET categories = @categories WHERE id = @id', { categories: mapped, id: row.id });
      printerTouched++;
    }
    console.log(`  Printers.categories: แก้ ${printerTouched} แถว`);
  });

  const mapping = {
    generatedAt: new Date().toISOString(),
    categories: Object.fromEntries(catMap),
    menu: Object.fromEntries(menuMap)
  };
  fs.writeFileSync(MAP_FILE, JSON.stringify(mapping, null, 2), 'utf8');
  console.log(`\n✅ เปลี่ยนรหัสเรียบร้อย — ตารางเทียบรหัสเก่า/ใหม่เก็บไว้ที่ ${path.relative(process.cwd(), MAP_FILE)}`);
  console.log('   เครื่องขายที่เปิดค้างอยู่ให้กดปุ่มรีเฟรชหนึ่งครั้ง เพื่อดึงเมนูชุดใหม่');
};

run()
  .then(async () => { const pool = await getPool(); await pool.close(); })
  .catch(err => { console.error('\n' + explainConnectError(err)); process.exit(1); });
