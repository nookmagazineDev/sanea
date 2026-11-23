import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, UtensilsCrossed, Tag, LogOut, Store, Layers, FileSpreadsheet, Globe, Users, Settings, Package,
  FlaskConical, BarChart2, Building2, Images, Receipt, Crown, Printer, LayoutGrid, ListChecks, Menu, X
} from 'lucide-react';
import './Admin.css';

// เมนูหลังบ้านจัดเป็นหมวด — admin = เห็นเฉพาะแอดมิน (แคชเชียร์ไม่เห็น) · สิทธิ์ตรงกับ Route ใน App.jsx
const NAV_GROUPS = [
  { th: 'ภาพรวม', en: 'Overview', items: [
    { to: '/admin', end: true, icon: LayoutDashboard, th: 'แดชบอร์ด', en: 'Dashboard' },
    { to: '/admin/reports', icon: BarChart2, th: 'รายงาน', en: 'Reports', admin: true }
  ] },
  { th: 'เมนูและการขาย', en: 'Menu & sales', items: [
    { to: '/admin/menu', icon: UtensilsCrossed, th: 'จัดการเมนู', en: 'Menu' },
    { to: '/admin/categories', icon: Layers, th: 'หมวดหมู่', en: 'Categories' },
    { to: '/admin/branch-menu', icon: ListChecks, th: 'เมนูรายสาขา', en: 'Branch menu', admin: true },
    { to: '/admin/member-menu', icon: Crown, th: 'เมนูสมาชิก', en: 'Member menu', admin: true },
    { to: '/admin/promotions', icon: Tag, th: 'ส่วนลด', en: 'Discounts' }
  ] },
  { th: 'หน้าร้าน', en: 'Storefront', items: [
    { to: '/admin/tables', icon: LayoutGrid, th: 'โต๊ะและราคา', en: 'Tables & prices' },
    { to: '/admin/banner', icon: Images, th: 'แบนเนอร์', en: 'Banner', admin: true }
  ] },
  { th: 'วัตถุดิบ', en: 'Inventory', items: [
    { to: '/admin/stock', icon: Package, th: 'สต็อกวัตถุดิบ', en: 'Stock' },
    { to: '/admin/bom', icon: FlaskConical, th: 'สูตรอาหาร (BOM)', en: 'Recipes (BOM)', admin: true }
  ] },
  { th: 'ตั้งค่า', en: 'Settings', items: [
    { to: '/admin/settings', icon: Settings, th: 'ตั้งค่าร้าน', en: 'Store settings', admin: true },
    { to: '/admin/receipt', icon: Receipt, th: 'ใบเสร็จ', en: 'Receipt', admin: true },
    { to: '/admin/printers', icon: Printer, th: 'เครื่องพิมพ์', en: 'Printers', admin: true },
    { to: '/admin/branches', icon: Building2, th: 'สาขา', en: 'Branches', admin: true },
    { to: '/admin/users', icon: Users, th: 'พนักงาน', en: 'Staff', admin: true }
  ] }
];

const AdminLayout = ({ lang, setLang, isCashier = false, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const th = lang === 'th';
  // จอแคบ (มือถือ/แท็บเล็ต): เมนูซ่อนเป็นลิ้นชัก กด ☰ เปิด · เลือกหน้าแล้วปิดเอง
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => !i.admin || !isCashier) }))
    .filter(g => g.items.length);
  const current = groups.flatMap(g => g.items).find(i => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));

  return (
    <div className={`admin-container${open ? ' nav-open' : ''}`}>
      {/* แถบบนสำหรับจอแคบ */}
      <header className="admin-topbar">
        <button type="button" className="admin-burger" onClick={() => setOpen(true)} aria-label={th ? 'เปิดเมนู' : 'Open menu'}>
          <Menu size={22} />
        </button>
        <span className="admin-topbar-title">{current ? (th ? current.th : current.en) : (th ? 'หลังบ้าน' : 'Admin')}</span>
      </header>
      <div className="admin-backdrop" onClick={close} />

      <aside className="admin-sidebar">
        <div className="admin-logo">
          <div className="admin-logo-row">
            <div>
              <h2>👑 {th ? 'หลังบ้าน' : 'Admin'}</h2>
              <p>เสน่ห์</p>
            </div>
            <button type="button" className="admin-close" onClick={close} aria-label={th ? 'ปิดเมนู' : 'Close menu'}>
              <X size={20} />
            </button>
          </div>
          <div className="admin-quick">
            <button type="button" onClick={() => navigate('/index')}>
              <Store size={15} /> {th ? 'หน้าร้าน' : 'Storefront'}
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => { if (onLogout && window.confirm(th ? 'ออกจากระบบ?' : 'Log out?')) onLogout(); }}
            >
              <LogOut size={15} /> {th ? 'ออกจากระบบ' : 'Logout'}
            </button>
          </div>
        </div>

        <nav className="admin-nav">
          {groups.map(g => (
            <div className="admin-nav-group" key={g.en}>
              <div className="admin-nav-heading">{th ? g.th : g.en}</div>
              {g.items.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={close} className={({ isActive }) => (isActive ? 'admin-link active' : 'admin-link')}>
                  {React.createElement(item.icon, { size: 18 })} <span>{th ? item.th : item.en}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {/* หน้าจอห้องครัว (/kitchen) ซ่อนลิงก์ไว้ก่อน — ร้านยังไม่มีจอสำหรับครัว (ใช้ใบครัวจาก Print Server) · หน้ายังเปิดได้ที่ /kitchen ถ้าต้องการใช้ภายหลัง */}
          {!isCashier && (
            <div className="admin-nav-group">
              <div className="admin-nav-heading">{th ? 'อื่น ๆ' : 'Other'}</div>
              <a href="https://docs.google.com/spreadsheets/" target="_blank" rel="noopener noreferrer" className="admin-link">
                <FileSpreadsheet size={18} /> <span>{th ? 'กูเกิลชีต (ข้อมูล)' : 'Google Sheets'}</span>
              </a>
            </div>
          )}
        </nav>

        <div className="admin-lang">
          <button type="button" onClick={() => setLang(th ? 'en' : 'th')}>
            <Globe size={16} /> {th ? 'English' : 'ภาษาไทย'}
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet context={{ lang, isCashier, canSeeCost: !isCashier }} />
      </main>
    </div>
  );
};

export default AdminLayout;
