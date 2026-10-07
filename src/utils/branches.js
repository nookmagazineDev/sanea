// ค่าพิเศษในช่องสาขาของพนักงาน = ทำงานได้ทุกสาขา (เช่นแอดมินสำนักงานใหญ่)
// ล็อกอินแล้วต้องเลือกก่อนว่าจะทำงานที่สาขาไหน เพราะหน้าขายต้องรู้ว่าบิลเป็นของสาขาใด
export const ALL_BRANCHES = '*';

export const isAllBranches = (value) => String(value ?? '').trim() === ALL_BRANCHES;

// ชื่อที่แสดงของรหัสสาขา — ใช้ชื่อจากหน้าตั้งค่าสาขา ไม่มีก็แสดงรหัส
export const branchLabel = (id, branches = []) => {
  const code = String(id ?? '').trim();
  if (isAllBranches(code)) return 'ทุกสาขา';
  const b = (branches || []).find(x => String(x.id) === code);
  return b && b.name ? b.name : code;
};
