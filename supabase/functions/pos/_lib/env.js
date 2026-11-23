// ค่าตั้งของฟังก์ชัน (Supabase: Edge Functions → Secrets) — SUPABASE_URL / SUPABASE_DB_URL / SUPABASE_SERVICE_ROLE_KEY ตั้งมาให้แล้ว
export const env = (key) => {
  try { return Deno.env.get(key) ?? ''; } catch { return ''; }
};
