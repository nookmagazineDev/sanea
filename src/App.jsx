import React, { useState } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { ShoppingCart, ClipboardList, Store, Globe, ShoppingBag, ChevronLeft, ChevronRight } from 'lucide-react';
import FoodCard from './components/FoodCard';
import OrderWizardModal from './components/OrderWizardModal';
import CartModal from './components/CartModal';
import CheckoutModal from './components/CheckoutModal';
import KitchenMonitor from './components/KitchenMonitor';
import AdminLayout from './components/admin/AdminLayout';
import Dashboard from './components/admin/Dashboard';
import ManageMenu from './components/admin/ManageMenu';
import ManagePromotions from './components/admin/ManagePromotions';
import ManageCategories from './components/admin/ManageCategories';
import ManagePrinters from './components/admin/ManagePrinters';
import HeroCarousel from './components/HeroCarousel';
import TableSelection from './components/TableSelection';
import TableOrderView from './components/TableOrderView';
import './index.css';

const MENU_ITEMS = [
  {
    id: 1,
    name: 'กะเพราหมูสับ',
    nameEn: 'Minced Pork Kra Pao',
    description: 'กะเพราหมูสับรสจัดจ้าน ผัดแห้งๆ หอมกลิ่นใบกะเพราแท้ๆ',
    descriptionEn: 'Spicy minced pork basil stir-fry, dry and aromatic',
    price: 60,
    image: '/images/kra_pao_moo_saap.png'
  },
  {
    id: 2,
    name: 'กะเพราหมูกรอบ',
    nameEn: 'Crispy Pork Kra Pao',
    description: 'หมูกรอบชิ้นโต หนังกรอบเนื้อนุ่ม ผัดคลุกเคล้าซอสกะเพราสูตรพิเศษ',
    descriptionEn: 'Large chunks of crispy pork belly tossed in special basil sauce',
    price: 80,
    image: '/images/kra_pao_moo_grob.png'
  },
  {
    id: 3,
    name: 'กะเพราทะเล',
    nameEn: 'Seafood Kra Pao',
    description: 'กุ้งและปลาหมึกสดชิ้นโต ผัดกะเพรารสเผ็ดร้อนถึงใจ',
    descriptionEn: 'Fresh shrimp and squid stir-fried with hot basil',
    price: 90,
    image: '/images/kra_pao_talay.png'
  },
  {
    id: 4,
    name: 'กะเพราเนื้อสับ',
    nameEn: 'Minced Beef Kra Pao',
    description: 'กะเพราเนื้อสับคัดพิเศษ ผัดแห้งหอมกลิ่นเนื้อและใบกะเพรา',
    descriptionEn: 'Premium minced beef, dry-fried with strong basil aroma',
    price: 85,
    image: '/images/kra_pao_nua.png'
  },
  {
    id: 5,
    name: 'กะเพราไก่สับ',
    nameEn: 'Minced Chicken Kra Pao',
    description: 'กะเพราไก่สับล้วนไม่ติดมัน รสชาติเข้มข้นถึงเครื่อง',
    descriptionEn: 'Lean minced chicken basil stir-fry, full of flavors',
    price: 55,
    image: '/images/kra_pao_gai.png'
  },
  {
    id: 6,
    name: 'กะเพราหมูยอ',
    nameEn: 'Sausage Kra Pao',
    description: 'หมูยอพริกไทยดำเกรดพรีเมียม ผัดกะเพรารสเด็ดจัดจ้าน',
    descriptionEn: 'Premium black pepper sausage in spicy basil stir-fry',
    price: 65,
    image: '/images/kra_pao_moo_yo.png'
  },
  {
    id: 101,
    category: 'drink',
    name: 'น้ำเปล่า',
    nameEn: 'Drinking Water',
    description: 'น้ำดื่มบรรจุขวดเย็นชื่นใจ',
    descriptionEn: 'Cold bottled drinking water',
    price: 15,
    image: 'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?q=80&w=600&auto=format&fit=crop'
  },
  {
    id: 102,
    category: 'drink',
    name: 'โค้ก ออริจินัล',
    nameEn: 'Coca-Cola Original',
    description: 'โค้กกระป๋องเย็นซ่า',
    descriptionEn: 'Cold refreshing Coke can',
    price: 20,
    image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?q=80&w=600&auto=format&fit=crop'
  },
  {
    id: 103,
    category: 'drink',
    name: 'ชาไทยเย็น',
    nameEn: 'Iced Thai Tea',
    description: 'ชาไทยหอมเข้มข้น หวานมันกลมกล่อม',
    descriptionEn: 'Rich and sweet traditional Thai milk tea',
    price: 35,
    image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?q=80&w=600&auto=format&fit=crop'
  }
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState('food');
  const [lang, setLang] = useState('th');
  const [tableNumber, setTableNumber] = useState(localStorage.getItem('table_number') || '');
  const isScrollingRef = React.useRef(false);

  React.useEffect(() => {
    if (tableNumber) localStorage.setItem('table_number', tableNumber);
    else localStorage.removeItem('table_number');
  }, [tableNumber]);

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';

  const [orders, setOrders] = useState([]);
  const [maxOrderNum, setMaxOrderNum] = useState(0);
  const [liveMenu, setLiveMenu] = useState([...MENU_ITEMS]);
  const [categories, setCategories] = useState([
    { slug: 'food', name: 'อาหาร', nameEn: 'Food', icon: '🍲' },
    { slug: 'drink', name: 'เครื่องดื่ม', nameEn: 'Drinks', icon: '🥤' }
  ]);
  const [allCategories, setAllCategories] = useState([]);
  const [allMenu, setAllMenu] = useState([...MENU_ITEMS]);

  // TABLE ORDERS STATE
  const [tableOrders, setTableOrders] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // CHECKOUT (from table view)
  const [checkoutItems, setCheckoutItems] = useState([]);
  const [checkoutTotal, setCheckoutTotal] = useState(0);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const processAppGASData = (data) => {
    if (data.categories && Array.isArray(data.categories) && data.categories.length > 0) {
      setAllCategories(data.categories);
      setCategories(data.categories.filter(c => c.isActive !== false));
    }
    if (data.orders && Array.isArray(data.orders)) {
      const groupedOrders = {};
      data.orders.forEach(row => {
        const num = row.OrderNumber;
        if (!num) return;
        if (!groupedOrders[num]) {
          groupedOrders[num] = {
            id: num,
            orderNumber: num,
            customerDetails: { name: row.CustomerName, address: row.Address },
            items: [],
            total: parseFloat(row.TotalAmount) || 0,
            status: (row.Status || 'pending').toLowerCase(),
            timestamp: row.OrderStartTime || row.Timestamp
          };
        } else if ((row.Status || '').toLowerCase() === 'pending') {
          groupedOrders[num].status = 'pending';
        }
        const isSubItem = typeof row.ItemDetail === 'string' && row.ItemDetail.trim().startsWith('↳');
        if (isSubItem && groupedOrders[num].items.length > 0) {
          const lastItem = groupedOrders[num].items[groupedOrders[num].items.length - 1];
          if (!lastItem.subItems) lastItem.subItems = [];
          lastItem.subItems.push(row.ItemDetail);
        } else {
          groupedOrders[num].items.push({ isFlattened: true, name: row.ItemDetail, dining: row.DiningOption });
        }
      });
      const sortedOrders = Object.values(groupedOrders).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setOrders(sortedOrders);
      let currentMax = 0;
      data.orders.forEach(row => {
        if (row.OrderNumber) {
          const val = parseInt(row.OrderNumber.replace(/\D/g, ''), 10);
          if (!isNaN(val) && val > currentMax) currentMax = val;
        }
      });
      setMaxOrderNum(prev => Math.max(prev, currentMax));
    }
    if (data.menu && Array.isArray(data.menu) && data.menu.length > 0) {
      setAllMenu(data.menu);
      setLiveMenu(data.menu.filter(m => m.isActive !== false));
    }
    if (data.tableOrders && Array.isArray(data.tableOrders)) {
      setTableOrders(data.tableOrders);
    }
  };

  const fetchOrdersFromSheet = async () => {
    const cached = localStorage.getItem('gas_all_data');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data) processAppGASData(data);
      } catch (e) { }
    }
    try {
      const resp = await fetch(GAS_URL + '?action=getAllData');
      const data = await resp.json();
      if (data) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        processAppGASData(data);
      }
    } catch (e) {
      console.error('Error fetching from GAS:', e);
    }
  };

  const refreshTableOrders = async () => {
    setIsRefreshing(true);
    await fetchOrdersFromSheet();
    setIsRefreshing(false);
  };

  React.useEffect(() => {
    fetchOrdersFromSheet();
    const interval = setInterval(fetchOrdersFromSheet, 10000);
    const handleLocalUpdate = () => {
      const cached = localStorage.getItem('gas_all_data');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed) processAppGASData(parsed);
        } catch (e) { }
      }
    };
    window.addEventListener('appDataChanged', handleLocalUpdate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('appDataChanged', handleLocalUpdate);
    };
  }, []);

  // Update active tab based on scroll position
  React.useEffect(() => {
    if (location.pathname !== '/index') return;
    const handleScroll = () => {
      const header = document.querySelector('.sticky-header');
      const offset = header ? header.offsetHeight + 20 : 120;
      const visibleCats = categories.filter(cat => liveMenu.some(i => (i.category || 'food') === cat.slug));
      if (isScrollingRef.current) return;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 10) {
        if (visibleCats.length > 0) {
          const lastSlug = visibleCats[visibleCats.length - 1].slug;
          if (activeCategory !== lastSlug) setActiveCategory(lastSlug);
          return;
        }
      }
      const sections = visibleCats.map(c => `${c.slug}-section`);
      let current = activeCategory;
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= offset && rect.bottom >= offset) {
            current = section.replace('-section', '');
            break;
          }
        }
      }
      if (current !== activeCategory) setActiveCategory(current);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname, categories, liveMenu, activeCategory]);

  React.useEffect(() => {
    if (categoryNavRef.current) {
      const activeTab = categoryNavRef.current.querySelector('.tab-btn.active');
      if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeCategory]);

  const scrollToCategory = (slug) => {
    isScrollingRef.current = true;
    setActiveCategory(slug);
    const el = document.getElementById(`${slug}-section`);
    const header = document.querySelector('.sticky-header');
    if (el) {
      const offset = header ? header.offsetHeight + 20 : 120;
      const y = el.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
    setTimeout(() => { isScrollingRef.current = false; }, 800);
  };

  const categoryNavRef = React.useRef(null);
  const scrollNav = (direction) => {
    if (categoryNavRef.current) categoryNavRef.current.scrollBy({ left: direction * 200, behavior: 'smooth' });
  };

  const [selectedFood, setSelectedFood] = useState(null);
  const [cart, setCart] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const handleOrderClick = (food) => {
    if (food.category === 'drink') {
      setCart([...cart, {
        cartId: Date.now() + Math.random(),
        food,
        quantity: 1,
        allPopups: [],
        spice: { name: '', nameEn: '' },
        promo: { id: 'none', name: '', nameEn: '', price: 0 },
        dining: { name: 'เครื่องดื่ม', nameEn: 'Drinks' }
      }]);
      setIsCartOpen(true);
    } else {
      setSelectedFood(food);
    }
  };

  const handleConfirmOrder = (baseFood, orderDetails) => {
    const bundledPopups = [];
    if (baseFood.bundledItems && baseFood.bundledItems.length > 0) {
      baseFood.bundledItems.forEach(bundledId => {
        const bundledFood = liveMenu.find(m => String(m.id) === String(bundledId));
        if (bundledFood) {
          bundledPopups.push({ ...bundledFood, id: `bundled_${bundledFood.id}`, price: 0, isBundled: true });
        }
      });
    }
    const allPopupsWithBundled = [...(orderDetails.allPopups || []), ...bundledPopups];
    const popupsIds = allPopupsWithBundled.map(p => p.id).sort().join('-') || 'no_popups';
    const cartItemId = `${baseFood.id}_${popupsIds}_${orderDetails.spice?.id}_${orderDetails.promo?.id}_${orderDetails.dining?.id}`;
    const existingItemIndex = cart.findIndex(item => item.cartItemId === cartItemId);
    let newCart;
    if (existingItemIndex >= 0) {
      newCart = [...cart];
      newCart[existingItemIndex].quantity += 1;
    } else {
      newCart = [...cart, {
        cartId: Date.now() + Math.random(),
        cartItemId,
        food: baseFood,
        quantity: 1,
        allPopups: allPopupsWithBundled,
        spice: orderDetails.spice,
        promo: orderDetails.promo,
        dining: orderDetails.dining
      }];
    }
    setCart(newCart);
    setSelectedFood(null);
    setIsCartOpen(true);
  };

  const handleUpdateQuantity = (cartId, delta) => {
    setCart(cart.map(item => {
      if (item.cartId === cartId) {
        const newQty = (item.quantity || 1) + delta;
        return { ...item, quantity: Math.max(1, newQty) };
      }
      return item;
    }));
  };

  const handleRemoveFromCart = (cartId) => {
    setCart(cart.filter(item => item.cartId !== cartId));
  };

  const handleDecreaseQuantity = (food) => {
    const cartItems = cart.filter(c => c.food.id === food.id);
    if (cartItems.length > 0) {
      const lastItem = cartItems[cartItems.length - 1];
      if (lastItem.quantity > 1) handleUpdateQuantity(lastItem.cartId, -1);
      else handleRemoveFromCart(lastItem.cartId);
    }
  };

  const getThaiTimeISO = () => {
    const d = new Date();
    const thaiTzOptions = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const parts = new Intl.DateTimeFormat('en-GB', thaiTzOptions).formatToParts(d);
    const p = {};
    parts.forEach(part => p[part.type] = part.value);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+07:00`;
  };

  // =============================================
  // NEW: Send cart items to TableOrders sheet
  // =============================================
  const handleSendOrderToTable = async () => {
    if (cart.length === 0) return;

    const sessionId = String(Date.now());
    const timestamp = getThaiTimeISO();

    // Optimistic update: add to local tableOrders immediately
    const newLocalItems = cart.map(item => {
      const parts = [];
      if (item.spice && item.spice.name) parts.push('ความเผ็ด: ' + item.spice.name);
      if (item.allPopups && item.allPopups.length > 0) item.allPopups.forEach(p => parts.push(p.name));
      if (item.promo && item.promo.id !== 'none' && item.promo.name) parts.push(item.promo.name);
      return {
        TableNumber: tableNumber,
        SessionId: sessionId,
        ItemName: item.food.name,
        ItemNameEn: item.food.nameEn || item.food.name,
        ItemPrice: Number(item.food.price) || 0,
        Quantity: Number(item.quantity) || 1,
        Options: parts.join(', '),
        Timestamp: timestamp,
        Status: 'pending'
      };
    });

    setTableOrders(prev => [...prev, ...newLocalItems]);
    setCart([]);
    setIsCartOpen(false);
    navigate('/table-orders');

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'addTableOrder',
          tableNumber: String(tableNumber),
          sessionId,
          items: cart,
          timestamp
        })
      });
      // Refresh after saving
      setTimeout(() => fetchOrdersFromSheet(), 2000);
    } catch (error) {
      console.error('Error saving table order:', error);
    }
  };

  // =============================================
  // NEW: Open checkout from table view
  // =============================================
  const handleOpenCheckoutFromTable = (items, total) => {
    setCheckoutItems(items);
    setCheckoutTotal(total);
    setIsCheckoutOpen(true);
  };

  // =============================================
  // NEW: Complete payment - save to Orders, clear TableOrders
  // =============================================
  const handleCheckoutComplete = async () => {
    const nextNum = maxOrderNum + 1;
    setMaxOrderNum(nextNum);
    const newOrderNumber = `#${String(nextNum).padStart(3, '0')}`;
    const timestamp = getThaiTimeISO();
    const customerName = tableNumber ? `โต๊ะ ${tableNumber}` : 'ไม่ระบุ';
    const address = tableNumber ? `โต๊ะ ${tableNumber}` : 'ไม่ได้กรอกพิกัด';

    const rowsToSend = [];
    checkoutItems.forEach(item => {
      const qty = Number(item.Quantity) || 1;
      const qtyText = qty > 1 ? ` (x${qty})` : '';
      const price = (Number(item.ItemPrice) || 0) * qty;
      rowsToSend.push([
        timestamp, newOrderNumber, customerName, address,
        item.ItemName + qtyText, 'ทานที่ร้าน', price,
        checkoutTotal, 'Completed', timestamp, timestamp
      ]);
      if (item.Options) {
        rowsToSend.push([
          timestamp, newOrderNumber, customerName, address,
          `↳ ${item.Options}`, 'ทานที่ร้าน', 0,
          checkoutTotal, 'Completed', timestamp, timestamp
        ]);
      }
    });

    const newOrder = {
      id: newOrderNumber,
      orderNumber: newOrderNumber,
      customerDetails: { name: customerName, address },
      items: checkoutItems.map(i => ({ isFlattened: true, name: i.ItemName, dining: 'ทานที่ร้าน' })),
      total: checkoutTotal,
      status: 'completed',
      timestamp
    };

    // Optimistic clear table orders
    setTableOrders(prev => prev.filter(o => String(o.TableNumber) !== String(tableNumber)));
    setOrders(prev => [...prev, newOrder]);
    setCheckoutItems([]);
    setIsCheckoutOpen(false);
    setTableNumber('');
    navigate('/table-select');

    try {
      // Save to Orders sheet
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'insertOrder', rows: rowsToSend })
      });
    } catch (error) {
      console.error('Error saving order:', error);
    }

    try {
      // Clear TableOrders for this table
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'clearTableOrders', tableNumber: String(tableNumber) })
      });
    } catch (error) {
      console.error('Error clearing table orders:', error);
    }

    try {
      // Print receipt
      const receiptIP = localStorage.getItem('printer_receipt_ip');
      if (receiptIP) {
        fetch(`http://${window.location.hostname}:3001/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: receiptIP, printerType: 'receipt', orderData: newOrder })
        }).catch(err => console.error('Silent print failed:', err));
      }
    } catch (e) { }
  };

  // =============================================
  // Delete a single item from table orders
  // =============================================
  const handleDeleteTableItem = async (item) => {
    // Optimistic remove
    setTableOrders(prev => {
      const idx = prev.findIndex(o =>
        String(o.TableNumber) === String(item.TableNumber) &&
        String(o.SessionId) === String(item.SessionId) &&
        String(o.ItemName) === String(item.ItemName)
      );
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'deleteTableOrderItem',
          tableNumber: String(item.TableNumber),
          sessionId: String(item.SessionId),
          itemName: String(item.ItemName)
        })
      });
    } catch (e) {
      console.error('Error deleting table item:', e);
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    setOrders(orders.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'updateStatus',
          orderId,
          status: newStatus,
          completionTime: newStatus.toLowerCase() === 'completed' ? getThaiTimeISO() : ''
        })
      });
    } catch (e) {
      console.error('Failed to update status in GAS:', e);
    }
  };

  const getCartTotal = () => {
    return cart.reduce((sum, item) => {
      let itemTotal = Number(item.food.price);
      if (item.allPopups && item.allPopups.length > 0) item.allPopups.forEach(p => { itemTotal += Number(p.price || 0); });
      if (item.promo && item.promo.price) itemTotal += Number(item.promo.price);
      return sum + (itemTotal * item.quantity);
    }, 0);
  };

  return (
    <div className="app-container">
      <Routes>
        <Route path="/" element={<Navigate to="/table-select" replace />} />

        <Route path="/table-select" element={
          <TableSelection
            setGlobalTableNumber={setTableNumber}
            lang={lang}
            tableOrders={tableOrders}
          />
        } />

        <Route path="/table-orders" element={
          !tableNumber ? <Navigate to="/table-select" replace /> :
            <TableOrderView
              tableNumber={tableNumber}
              tableOrders={tableOrders}
              lang={lang}
              onAddMore={() => navigate('/index')}
              onCheckout={handleOpenCheckoutFromTable}
              onDeleteItem={handleDeleteTableItem}
              onBack={() => {
                setTableNumber('');
                navigate('/table-select');
              }}
              onRefresh={refreshTableOrders}
              isRefreshing={isRefreshing}
            />
        } />

        <Route path="/index" element={
          !tableNumber ? <Navigate to="/table-select" replace /> :
            <>
              <header className="app-header sticky-header" style={{ margin: '0 0 1rem 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                      <img src="/logo.png" alt="Logo" style={{ height: '48px', width: '48px', objectFit: 'cover', borderRadius: '50%', border: '2px solid gold' }} />
                      <span>{lang === 'th' ? 'เสน่ห์' : 'Sa-Nae'}</span>
                    </h1>
                    <p style={{ margin: '4px 0 0 60px', fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' }}>
                      {lang === 'th' ? `โต๊ะ ${tableNumber}` : `Table ${tableNumber}`}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                      onClick={() => navigate('/table-orders')}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'white',
                        padding: '0.5rem 0.8rem',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        transition: 'all 0.2s'
                      }}
                    >
                      🧾 {lang === 'th' ? 'โต๊ะ' : 'Table'}
                    </button>

                    <button
                      onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
                      style={{
                        background: 'rgba(0,0,0,0.3)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'white',
                        padding: '0.5rem 0.8rem',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        fontSize: '0.9rem',
                        transition: 'all 0.2s'
                      }}
                      className="lang-toggle-hover"
                    >
                      <Globe size={16} />
                      {lang === 'th' ? 'TH' : 'EN'}
                    </button>

                    <button
                      onClick={() => setIsCartOpen(true)}
                      style={{
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        padding: '0.5rem',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        boxShadow: '0 4px 12px rgba(249, 115, 22, 0.4)',
                        transition: 'all 0.2s'
                      }}
                      className="cart-btn-hover"
                    >
                      <ShoppingBag size={22} />
                      {cart.length > 0 && (
                        <span style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-6px',
                          background: '#b91c1c',
                          color: 'white',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          minWidth: '20px',
                          height: '20px',
                          borderRadius: '10px',
                          padding: '0 4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '2px solid var(--bg-dark)'
                        }}>
                          {cart.reduce((s, i) => s + (i.quantity || 1), 0)}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', width: '100%', position: 'relative' }}>
                  <button onClick={() => scrollNav(-1)} style={{ background: 'none', border: 'none', color: 'white', padding: '0 0.5rem', cursor: 'pointer', flexShrink: 0, opacity: 0.8 }} aria-label="Scroll left">
                    <ChevronLeft size={24} />
                  </button>
                  <div className="category-tabs" ref={categoryNavRef} style={{ flex: 1, margin: 0, paddingBottom: '0.5rem', borderBottom: 'none', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {categories.filter(cat => liveMenu.some(i => (i.category || 'food') === cat.slug)).map(cat => (
                      <button
                        key={cat.slug}
                        className={`tab-btn ${activeCategory === cat.slug ? 'active' : ''}`}
                        onClick={() => scrollToCategory(cat.slug)}
                      >
                        <span style={{ fontSize: '1.25rem' }}>{cat.icon}</span> {lang === 'th' ? cat.name : cat.nameEn}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => scrollNav(1)} style={{ background: 'none', border: 'none', color: 'white', padding: '0 0.5rem', cursor: 'pointer', flexShrink: 0, opacity: 0.8 }} aria-label="Scroll right">
                    <ChevronRight size={24} />
                  </button>
                </div>
              </header>

              <div style={{ marginBottom: '1.5rem' }}>
                <HeroCarousel />
              </div>

              <div className="menu-container">
                {categories.filter(cat => liveMenu.some(i => (i.category || 'food') === cat.slug)).map((cat, index, arr) => (
                  <React.Fragment key={cat.slug}>
                    <div className="category-section" id={`${cat.slug}-section`} style={{ paddingTop: '1rem' }}>
                      <h2 className="section-title">{lang === 'th' ? cat.name : cat.nameEn}</h2>
                      <main className="food-list">
                        {liveMenu.filter(i => (i.category || 'food') === cat.slug).map((item) => (
                          <FoodCard
                            key={item.id}
                            food={item}
                            lang={lang}
                            onOrderClick={handleOrderClick}
                            onDecreaseClick={handleDecreaseQuantity}
                            cartQuantity={cart.filter(c => c.food.id === item.id).reduce((sum, c) => sum + (c.quantity || 1), 0)}
                          />
                        ))}
                      </main>
                    </div>
                    {index < arr.length - 1 && (
                      <div className="category-separator">
                        <div className="separator-line"></div>
                        <div className="separator-dot"></div>
                        <div className="separator-line"></div>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
        } />

        <Route path="/kitchen" element={
          <KitchenMonitor
            orders={orders.filter(o => o.status && o.status.toLowerCase() === 'pending')}
            onUpdateOrderStatus={handleUpdateOrderStatus}
            onNewOrder={() => navigate('/index')}
          />
        } />

        <Route path="/admin" element={<AdminLayout lang={lang} setLang={setLang} />}>
          <Route index element={<Dashboard />} />
          <Route path="menu" element={<ManageMenu />} />
          <Route path="categories" element={<ManageCategories />} />
          <Route path="promotions" element={<ManagePromotions />} />
          <Route path="printers" element={<ManagePrinters />} />
        </Route>
      </Routes>

      {selectedFood && (
        <OrderWizardModal
          food={selectedFood}
          lang={lang}
          liveMenu={allMenu.length > 0 ? allMenu : liveMenu}
          categories={allCategories.length > 0 ? allCategories : categories}
          onClose={() => setSelectedFood(null)}
          onConfirm={handleConfirmOrder}
        />
      )}

      {isCartOpen && (
        <CartModal
          cart={cart}
          lang={lang}
          onClose={() => setIsCartOpen(false)}
          onRemove={handleRemoveFromCart}
          onUpdateQuantity={handleUpdateQuantity}
          onCheckout={handleSendOrderToTable}
        />
      )}

      {isCheckoutOpen && (
        <CheckoutModal
          tableOrderItems={checkoutItems}
          total={checkoutTotal}
          lang={lang}
          orderNumber={`#${String(maxOrderNum + 1).padStart(3, '0')}`}
          onClose={() => setIsCheckoutOpen(false)}
          onComplete={handleCheckoutComplete}
        />
      )}
    </div>
  );
}

export default App;
