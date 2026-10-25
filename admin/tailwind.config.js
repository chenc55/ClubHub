/**
 * Tailwind 主题扩展（P0-03 产物）
 * 唯一来源：design.md「2.1 颜色系统 + 4.1 Tailwind 配置」
 * 页面/组件一律使用语义类，禁止私设 hex
 */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        /* 画布与背景 */
        canvas: '#F8F9FF',
        card: '#FFFFFF',
        /* 品牌主色 */
        primary: {
          DEFAULT: '#2F80ED',
          hover: '#1D68D8',
          light: '#EFF4FF',
        },
        /* 功能辅助与状态色 */
        success: { DEFAULT: '#06D6A0', light: '#E6FAF5' },
        warning: { DEFAULT: '#FFD166', light: '#FFF9E6' },
        danger: { DEFAULT: '#F43F5E', light: '#FEE2E2' },
        info: { DEFAULT: '#0EA5E9', light: '#E0F2FE', text: '#0284C7' },
        /* 孟菲斯色板 */
        memphis: {
          dark: '#0F172A',
          yellow: '#FFD166',
          green: '#06D6A0',
          red: '#F43F5E',
          cyan: '#0EA5E9',
        },
        /* 文字与描边 */
        ink: {
          title: '#0F172A',
          body: '#334155',
          muted: '#64748B',
          line: '#E2E8F0',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"PingFang SC"', '"HarmonyOS Sans"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'memphis-xs': '1px 1px 0px #0F172A',
        'memphis-sm': '2px 2px 0px #0F172A',
        'memphis-md': '3px 3px 0px #0F172A',
        'memphis-lg': '4px 4px 0px #0F172A',
      },
      borderWidth: {
        3: '3px',
      },
    },
  },
  plugins: [],
}