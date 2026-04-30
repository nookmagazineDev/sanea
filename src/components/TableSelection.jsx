import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './TableSelection.css';

const TableSelection = ({ setGlobalTableNumber, lang, tableOrders = [] }) => {
  const navigate = useNavigate();
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [selectedTableForCustomer, setSelectedTableForCustomer] = useState(null);
  const [customerCount, setCustomerCount] = useState(1);

  const predefinedTables = Array.from({ length: 16 }, (_, i) => i + 1);

  const getTableItemCount = (num) => {
    return tableOrders.filter(
      o => String(o.TableNumber) === String(num) && o.Status !== 'paid'
    ).length;
  };

  const handleSelectTable = (num) => {
    const count = getTableItemCount(num);
    if (count > 0) {
      setGlobalTableNumber(num);
      navigate('/table-orders');
    } else {
      setSelectedTableForCustomer(num);
      setCustomerCount(1);
      setShowCustomerModal(true);
    }
  };

  const handleConfirmCustomerCount = () => {
    if (selectedTableForCustomer && customerCount > 0) {
      localStorage.setItem('customer_count_' + selectedTableForCustomer, customerCount);
      setGlobalTableNumber(selectedTableForCustomer);
      setShowCustomerModal(false);
      navigate('/index'); // go straight to ordering for new tables
    }
  };

  return (
    <div className="table-selection-container">
      <div className="table-selection-card">
        <h1 className="table-selection-title">
          {lang === 'th' ? 'เสน่ห์' : 'Sa-Nae'}
        </h1>
        <p className="table-selection-subtitle">
          {lang === 'th' ? 'เลือกโต๊ะเพื่อดูรายการอาหาร' : 'Select a table to view orders'}
        </p>

        <div className="table-grid">
          {predefinedTables.map(num => {
            const count = getTableItemCount(num);
            const hasOrders = count > 0;
            return (
              <button
                key={num}
                className={`table-btn ${hasOrders ? 'table-btn-active' : ''}`}
                onClick={() => handleSelectTable(num)}
                style={{ position: 'relative' }}
              >
                {num}
                {hasOrders && (
                  <span style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    background: '#b91c1c',
                    color: 'white',
                    fontSize: '0.7rem',
                    fontWeight: '800',
                    minWidth: '20px',
                    height: '20px',
                    borderRadius: '10px',
                    padding: '0 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid #1a0000',
                    boxShadow: '0 2px 6px rgba(185,28,28,0.5)'
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="table-custom-input">
          <div className="separator">
            <span>{lang === 'th' ? 'หรือระบุเบอร์โต๊ะอื่นๆ' : 'Or enter custom table'}</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const val = e.target.elements.tableInput.value.trim();
              if (val) handleSelectTable(val);
            }}
            style={{ display: 'flex', gap: '8px', marginTop: '16px' }}
          >
            <input
              type="text"
              name="tableInput"
              placeholder={lang === 'th' ? 'ระบุเบอร์โต๊ะ' : 'Enter table #'}
              className="table-input"
            />
            <button type="submit" className="table-submit-btn">
              {lang === 'th' ? 'ตกลง' : 'Confirm'}
            </button>
          </form>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#b91c1c', display: 'inline-block' }} />
          {lang === 'th' ? 'มีรายการอาหาร' : 'Has active orders'}
        </div>
      </div>

      {/* Customer Count Modal */}
      {showCustomerModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '320px',
            padding: '1.5rem',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'white', textAlign: 'center' }}>
              {lang === 'th' ? `โต๊ะ ${selectedTableForCustomer}` : `Table ${selectedTableForCustomer}`}
            </h3>
            
            <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <label style={{ display: 'block', marginBottom: '0.8rem', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                {lang === 'th' ? 'ระบุจำนวนลูกค้า (ท่าน)' : 'Enter Customer Count'}
              </label>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                <button
                  onClick={() => setCustomerCount(Math.max(1, customerCount - 1))}
                  style={{
                    width: '40px', height: '40px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: 'white',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  -
                </button>
                <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)', minWidth: '40px' }}>
                  {customerCount}
                </span>
                <button
                  onClick={() => setCustomerCount(customerCount + 1)}
                  style={{
                    width: '40px', height: '40px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: 'white',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  +
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowCustomerModal(false)}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  padding: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirmCustomerCount}
                style={{
                  flex: 1,
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  padding: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                {lang === 'th' ? 'ตกลง' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableSelection;
