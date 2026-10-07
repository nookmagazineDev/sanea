import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dist = ไฟล์ build, gas_complete_script.js = โค้ดฝั่ง Google Apps Script (รันบน runtime ของ Google คนละชุด globals)
  globalIgnores(['dist', 'gas_complete_script.js']),

  // สคริปต์ฝั่ง Node (เซิร์ฟเวอร์เครื่องพิมพ์ / เดโม / ไฟล์ config) — ใช้ globals ของ Node
  {
    files: ['server.js', 'pushDemo.js', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // โค้ดแอป React
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // caughtErrors: 'none' + allowEmptyCatch → รองรับ pattern `catch {}` ที่ตั้งใจกลืน error (กันแอปล่มตอน fetch ออฟไลน์)
      // ignoreRestSiblings → รองรับ pattern `const { omit, ...rest } = obj` ที่ตั้งใจตัด field ทิ้ง
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
])
