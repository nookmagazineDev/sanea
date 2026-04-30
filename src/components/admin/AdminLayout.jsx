import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UtensilsCrossed, Tag, LogOut, Store, Layers, FileSpreadsheet, Globe, Users } from 'lucide-react';
import './Admin.css';

const AdminLayout = ({ lang, setLang }) => {
  const navigate = useNavigate();

  return (
    <div className="admin-container">
       <aside className="admin-sidebar">
          <div className="admin-logo">
             <h2>👑 {lang === 'th' ? 'แผงควบคุม' : 'Admin Panel'}</h2>
             <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{lang === 'th' ? 'เสน่ห์' : 'SA-NAE'}</p>
          </div>
          <nav className="admin-nav">
             <NavLink to="/admin" end className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <LayoutDashboard size={20} /> {lang === 'th' ? 'แดชบอร์ด' : 'Dashboard'}
             </NavLink>
             <NavLink to="/admin/menu" className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <UtensilsCrossed size={20} /> {lang === 'th' ? 'จัดการเมนู' : 'Manage Menu'}
             </NavLink>
             <NavLink to="/admin/categories" className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <Layers size={20} /> {lang === 'th' ? 'หมวดหมู่' : 'Categories'}
             </NavLink>
             <NavLink to="/admin/users" className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <Users size={20} /> {lang === 'th' ? 'พนักงาน' : 'Users'}
             </NavLink>
             <NavLink to="/admin/promotions" className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <Tag size={20} /> {lang === 'th' ? 'โปรโมชัน' : 'Promotions'}
             </NavLink>
             <NavLink to="/admin/printers" className={({isActive}) => isActive ? "admin-link active" : "admin-link"}>
                <Store size={20} /> {lang === 'th' ? 'ปริ้นเตอร์' : 'Printers'}
             </NavLink>
             <a href="/kitchen" className="admin-link" onClick={(e) => { e.preventDefault(); navigate('/kitchen'); }}>
                <Store size={20} /> {lang === 'th' ? 'หน้าจอห้องครัว' : 'Kitchen Monitor'}
             </a>
             <a href="https://docs.google.com/spreadsheets/" target="_blank" rel="noopener noreferrer" className="admin-link">
                <FileSpreadsheet size={20} /> {lang === 'th' ? 'กูเกิลชีต (ข้อมูล)' : 'Google Sheets'}
             </a>
             
             <button 
               className="admin-link" 
               style={{ marginTop: 'auto', background: 'rgba(255,255,255,0.1)', justifyContent: 'center' }} 
               onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
             >
                <Globe size={20} /> {lang === 'th' ? 'English' : 'ภาษาไทย'}
             </button>

             <button className="admin-link logout" style={{ marginTop: '0.5rem' }} onClick={() => navigate('/index')}>
                <LogOut size={20} /> {lang === 'th' ? 'กลับสู่หน้าร้าน' : 'Exit to Storefront'}
             </button>
          </nav>
       </aside>
       <main className="admin-main">
          <Outlet context={{ lang }} />
       </main>
    </div>
  );
};

export default AdminLayout;
