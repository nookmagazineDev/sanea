// เครื่องยิง QR แบบ USB (ส่งรหัสเป็นการกดคีย์บอร์ดเร็ว ๆ แล้วกด Enter) · ใช้ร่วมกันทั้งหน้าขายและหน้าชำระเงิน
import { useEffect, useRef } from 'react';

// รหัสจาก QR ในบัตรสมาชิก LINE เท่านั้น: อักษร 2 ตัว + จุด เช่น QR.xxx (บัตรสมาชิก) CQ.xxx (QR คูปอง)
// เบอร์โทร (ตัวเลข) และเลขสมาชิก (MB-xxxxxxx) ไม่เข้ารูปแบบนี้ → พิมพ์เองไม่ได้
export const isQrCode = (s) => /^[A-Z]{2}\.\S{4,}$/i.test(String(s || '').trim());

// เครื่องยิง QR ส่งเป็นปุ่มคีย์บอร์ด · ถ้าเครื่องตั้งภาษาไทยอยู่ e.key จะกลายเป็นอักษรไทย
// → แปลงจากตำแหน่งปุ่ม (e.code) ตามแป้นอังกฤษแทน ไม่ต้องสลับภาษาก่อนยิง
const US_KEYS = {
  Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
  Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'], Backquote: ['`', '~'],
  Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'], Digit5: ['5', '%'],
  Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'],
  NumpadDecimal: ['.', '.'], NumpadSubtract: ['-', '-'], NumpadAdd: ['+', '+'], NumpadDivide: ['/', '/'], NumpadMultiply: ['*', '*']
};
// ใช้ตำแหน่งปุ่ม (e.code) ก่อนเสมอ เพราะแป้นไทยบางปุ่มให้อักษรอังกฤษคนละตัว (เช่น ปุ่ม 2 = "/", ปุ่ม 3 = "-")
// ตัวพิมพ์เล็ก/ใหญ่ดูจาก Shift ที่เครื่องยิงกด (ไม่ดู Caps Lock เพราะเครื่องยิงส่ง Shift ตามรหัสจริงอยู่แล้ว)
export const scannerChar = (e) => {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return e.shiftKey ? c[3] : c[3].toLowerCase();
  if (/^Numpad[0-9]$/.test(c)) return c[6];
  const k = US_KEYS[c];
  if (k) return k[e.shiftKey ? 1 : 0];
  return e.key && e.key.length === 1 && e.key.charCodeAt(0) < 128 ? e.key : '';
};

// ฟังการยิง QR ทั้งหน้าจอ (ไม่ต้องคลิกช่องไหนก่อน) · คนพิมพ์เองช้ากว่าเครื่องยิง → ไม่นับ · รับเฉพาะรหัส QR จากบัตรสมาชิก LINE
// ไม่ยุ่งกับการพิมพ์ในช่องกรอกข้อความ
export function useScannerWedge(active, onCode) {
  const cb = useRef(onCode);
  useEffect(() => { cb.current = onCode; });
  useEffect(() => {
    if (!active) return undefined;
    let buf = ''; let last = 0;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const now = Date.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        const code = buf; buf = '';
        if (isQrCode(code)) { e.preventDefault(); cb.current(code); }
        return;
      }
      const ch = scannerChar(e);
      if (ch) buf += ch;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
