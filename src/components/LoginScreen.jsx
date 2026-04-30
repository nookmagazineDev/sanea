import React, { useState } from 'react';
import { User, Lock, ArrowRight, Delete } from 'lucide-react';
import './LoginScreen.css';

const LoginScreen = ({ users, onLogin, lang, isOfflineMode }) => {
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleUserSelect = (user) => {
    setSelectedUser(user);
    setPin('');
    setError('');
  };

  const handlePinPress = (digit) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        verifyLogin(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  const verifyLogin = (enteredPin) => {
    if (String(selectedUser.pin) === String(enteredPin)) {
      onLogin(selectedUser);
    } else {
      setError(lang === 'th' ? 'รหัส PIN ไม่ถูกต้อง' : 'Invalid PIN');
      setPin('');
    }
  };

  const handleDefaultAdmin = () => {
    onLogin({ id: 'admin', username: 'Admin', canCheckout: true, isAdmin: true });
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">
          {lang === 'th' ? 'เข้าสู่ระบบ' : 'Login'}
        </h1>
        <p className="login-subtitle">
          {lang === 'th' ? 'เลือกรหัสพนักงานของคุณ' : 'Select your user account'}
        </p>

        {(!users || users.length === 0) ? (
          <div className="no-users-container">
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
              {lang === 'th' ? 'ยังไม่มีรายชื่อพนักงานในระบบ' : 'No users found in the system'}
            </p>
            <button onClick={handleDefaultAdmin} className="default-admin-btn">
              {lang === 'th' ? 'เข้าสู่ระบบในฐานะแอดมิน (เริ่มต้น)' : 'Login as Default Admin'}
            </button>
            {isOfflineMode && (
               <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '1rem' }}>
                 {lang === 'th' ? 'กำลังเชื่อมต่อฐานข้อมูล กรุณารอสักครู่...' : 'Connecting to database, please wait...'}
               </p>
            )}
          </div>
        ) : !selectedUser ? (
          <div className="user-grid">
            {users.map(user => (
              <button
                key={user.id}
                className="user-select-btn"
                onClick={() => handleUserSelect(user)}
              >
                <div className="user-avatar">
                  <User size={28} />
                </div>
                <span>{user.username}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pin-container">
            <div className="selected-user-header">
              <button className="back-btn" onClick={() => setSelectedUser(null)}>
                <ArrowRight size={20} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <div className="current-user-info">
                <User size={20} />
                <span>{selectedUser.username}</span>
              </div>
            </div>

            <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              {lang === 'th' ? 'กรุณากรอกรหัส PIN 4 หลัก' : 'Enter 4-digit PIN'}
            </p>

            <div className="pin-dots">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`}></div>
              ))}
            </div>

            {error && <div className="pin-error">{error}</div>}

            <div className="pin-numpad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button key={num} className="numpad-btn" onClick={() => handlePinPress(String(num))}>
                  {num}
                </button>
              ))}
              <div className="numpad-empty"></div>
              <button className="numpad-btn" onClick={() => handlePinPress('0')}>0</button>
              <button className="numpad-btn delete" onClick={handleDelete}>
                <Delete size={24} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginScreen;
