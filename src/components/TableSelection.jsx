import React from 'react';
import { useNavigate } from 'react-router-dom';
import './TableSelection.css';

const TableSelection = ({ setGlobalTableNumber, lang, tableOrders = [] }) => {
  const navigate = useNavigate();

  const predefinedTables = Array.from({ length: 16 }, (_, i) => i + 1);

  const getTableItemCount = (num) => {
    return tableOrders.filter(
      o => String(o.TableNumber) === String(num) && o.Status !== 'paid'
    ).length;
  };

  const handleSelectTable = (num) => {
    setGlobalTableNumber(num);
    navigate('/table-orders');
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
    </div>
  );
};

export default TableSelection;
