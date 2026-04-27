import React, { useState, useEffect } from 'react';
import { DollarSign, ShoppingBag, Clock, TrendingUp } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';

const Dashboard = () => {
  const { lang } = useOutletContext();
  const [stats, setStats] = useState({
    totalRevenue: 0,
    totalOrders: 0,
    pendingOrders: 0,
    recentOrders: []
  });

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxwR7-oivm8zdCbUtgznjoafFyfJg09TM_Iy3s8pPcOROLcsvn0CkvHt3XoH7mlU9Z-Hw/exec';

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const processDashboardData = (data) => {
    const orders = data.orders;
    const orderGroups = {};
    orders.forEach(line => {
       if (!orderGroups[line.OrderNumber]) {
           orderGroups[line.OrderNumber] = {
               totalAmount: line.TotalAmount,
               status: line.Status,
               timestamp: line.Timestamp,
               customer: line.CustomerName
           };
       }
    });

    let revenue = 0;
    let pending = 0;
    let totalCount = 0;
    const uniqueOrdersList = Object.keys(orderGroups).map(k => ({ id: k, ...orderGroups[k] }));
    
    uniqueOrdersList.forEach(o => {
        totalCount++;
        revenue += parseFloat(o.totalAmount || 0);
        if (o.status && o.status.toLowerCase() !== 'success') {
            pending++;
        }
    });

    const recent = uniqueOrdersList.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);

    setStats({
      totalRevenue: revenue,
      totalOrders: totalCount,
      pendingOrders: pending,
      recentOrders: recent
    });
  };

  const fetchDashboardData = async () => {
    const cached = localStorage.getItem('gas_all_data');
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data && data.orders) processDashboardData(data);
      } catch(e) {}
    }

    try {
      const resp = await fetch(GAS_URL + '?action=getAllData');
      const data = await resp.json();
      if (data && data.orders) {
        localStorage.setItem('gas_all_data', JSON.stringify(data));
        processDashboardData(data);
      }
    } catch(e) {
      console.error('Failed to load dashboard data:', e);
    }
  };

  return (
    <div>
      <div className="admin-header">
        <h1>{lang === 'th' ? 'ภาพรวมแดชบอร์ด' : 'Dashboard Overview'}</h1>
        <p>{lang === 'th' ? 'อัปเดตผลการดำเนินงานของร้านตามเวลาจริง' : 'Real-time updates on your store\'s performance.'}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
            <DollarSign size={28} />
          </div>
          <div className="stat-details">
            <h3>{lang === 'th' ? 'ยอดขายรวม (฿)' : 'Total Sales (฿)'}</h3>
            <p>{stats.totalRevenue.toLocaleString()}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
            <ShoppingBag size={28} />
          </div>
          <div className="stat-details">
            <h3>{lang === 'th' ? 'จำนวนออเดอร์' : 'Total Orders'}</h3>
            <p>{stats.totalOrders}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(249, 115, 22, 0.1)', color: '#f97316' }}>
            <Clock size={28} />
          </div>
          <div className="stat-details">
            <h3>{lang === 'th' ? 'คิวที่รอคอย' : 'Pending Queues'}</h3>
            <p>{stats.pendingOrders}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            <TrendingUp size={28} />
          </div>
          <div className="stat-details">
            <h3>{lang === 'th' ? 'การเปรียบเทียบ' : 'Conversion'}</h3>
            <p>{lang === 'th' ? 'สูง' : 'High'}</p>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <h3 style={{ margin: '0 0 1.5rem 0' }}>{lang === 'th' ? 'ธุรกรรมล่าสุด' : 'Recent Transactions'}</h3>
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{lang === 'th' ? 'รหัสออเดอร์' : 'Order ID'}</th>
                <th>{lang === 'th' ? 'เวลา' : 'Time'}</th>
                <th>{lang === 'th' ? 'ยอดเงิน' : 'Amount'}</th>
                <th>{lang === 'th' ? 'สถานะ' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentOrders.length > 0 ? (
                stats.recentOrders.map((order, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{order.id}</td>
                    <td>{order.timestamp}</td>
                    <td>฿{order.totalAmount}</td>
                    <td>
                       <span style={{ 
                         padding: '0.25rem 0.5rem', 
                         borderRadius: '4px', 
                         fontSize: '0.85rem',
                         background: order.status === 'Success' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(249, 115, 22, 0.2)',
                         color: order.status === 'Success' ? '#22c55e' : '#f97316'
                       }}>
                         {order.status || 'Pending'}
                       </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    {lang === 'th' ? 'ไม่พบออเดอร์ล่าสุด' : 'No recent orders found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
