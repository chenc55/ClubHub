# 社团星球 (ClubHub) · DESIGN.md 设计系统与前端开发规范

> **版本**：v1.0 (生产交付级规范)
> **视觉基调**：Neo-Memphis 现代孟菲斯校园风（高饱和撞色 + 硬朗线条 + 几何硬投影 + 活力排版）
> **适用终端**：移动端微信小程序 (uni-app + uni-ui) / Web 用户端 + Web 运营管理端 (Vue 3 + Tailwind CSS + Element Plus)
> **配套设计资产**：
> - 设计系统标记：`{{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}` (Neo-Memphis Campus Hub)
> - 品牌 Logo：`{{DATA:IMAGE:IMAGE_9}}` (星球轨道环 + 校园星标几何徽章)
> - 核心页面基准：
>   - 移动端首页：`{{DATA:SCREEN:SCREEN_8}}`
>   - 移动端社团库：`{{DATA:SCREEN:SCREEN_6}}`
>   - 桌面管理端审核页：`{{DATA:SCREEN:SCREEN_4}}`

---

## 1. 设计理念与设计原则 (Design Philosophy & Principles)

### 1.1 风格定位：Neo-Memphis Campus Hub
将**经典孟菲斯设计（Memphis Milano）**的几何破格、明快波点与大胆撞色，与现代移动端/中后台的高效可用性（Modern Functional UI）相结合：
1. **活力青春 (Vibrant & Energetic)**：摒弃沉闷单调的纯灰白工具感，以大学活力蓝（#2F80ED）为主基调，辅以薄荷绿、暖阳黄、珊瑚粉的高彩度点缀，塑造大学校园青年专属的蓬勃朝气。
2. **结构硬朗 (Crisp & Structured)**：采用纯黑高对比轮廓线（`2px solid #0F172A`）与无模糊实心偏移阴影（`Hard Drop Shadows: 2px ~ 4px`），消除拟物毛玻璃的朦胧感，强化界面的几何笃定感与信息分界。
3. **信息舒展与水平优先 (Horizontal Flow & Zero Overlap)**：
   - 严禁表头或核心字段发生单字纵向折行挤压；
   - 姓名、认证标、学号、社团与分类胶囊优先采用 Flex 单行平铺横向布局；
   - 复杂表格设置横向最小安全宽度（`min-w-[1280px]`）并提供平滑水平滚动容器。

---

## 2. 设计令牌系统 (Design Tokens)

### 2.1 颜色系统 (Color Tokens)

#### 品牌主色 (Brand Primary)
| 变量名 | HEX | 作用说明 | Tailwind 映射 |
| :--- | :--- | :--- | :--- |
| `--color-primary` | `#2F80ED` | 活力大学蓝，主 CTA、核心激活 Tab、主导航表头、重点强调 | `bg-primary` / `text-primary` |
| `--color-primary-hover` | `#1D68D8` | 主色悬停态 / 点击态 | `hover:bg-blue-600` |
| `--color-primary-light` | `#EFF4FF` | 主色浅色容器背景、激活胶囊底色 | `bg-blue-50` |

#### 功能辅助与状态色 (Functional & Status)
| 变量名 | HEX | 语义说明 | 典型组件应用 |
| :--- | :--- | :--- | :--- |
| `--color-success` | `#06D6A0` | 薄荷翡翠绿，代表审核通过、招新中、签到成功、活动进行中 | 状态徽标、通过按钮、招新胶囊 |
| `--color-success-light`| `#E6FAF5` | 浅绿背景容器 | 成功态 Tag 底色 |
| `--color-warning` | `#FFD166` | 暖阳金黄，代表待审核 Pending、星级评定、重要提醒、加急标记 | 5星徽章、待审核胶囊、警告通知 |
| `--color-warning-light`| `#FFF9E6` | 浅黄背景容器 | 待办卡片底色 |
| `--color-danger` | `#F43F5E` | 珊瑚桃红，代表审核驳回、报名已满、截止预警、删除/停用 | 拒绝按钮、驳回徽标、下架警示 |
| `--color-danger-light` | `#FEE2E2` | 浅红背景容器 | 驳回理由提示底色 |
| `--color-info` | `#0EA5E9` | 晴空湖蓝，代表白名单验证通过、公告分类、链接交互 | 白名单认证标、数据指标卡 |

#### 中性色与背景系统 (Neutrals & Surfaces)
| 变量名 | HEX | 语义说明 | Tailwind 映射 |
| :--- | :--- | :--- | :--- |
| `--color-bg-canvas` | `#F8F9FF` | 全局页面画布底色（微蓝冷白，避免纯灰冷感） | `bg-[#F8F9FF]` |
| `--color-bg-card` | `#FFFFFF` | 卡片与容器主底色 | `bg-white` |
| `--color-border-dark` | `#0F172A` | 孟菲斯经典硬轮廓黑边（2px solid） | `border-slate-900` |
| `--color-border-light`| `#E2E8F0` | 次级分割线、表头内细边框 | `border-slate-200` |
| `--color-text-title` | `#0F172A` | 主标题、姓名、重要数据大字（极深蓝灰） | `text-slate-900` |
| `--color-text-body` | `#334155` | 正文字段、表格详情说明 | `text-slate-700` |
| `--color-text-muted` | `#64748B` | 次要描述、占位说明、相对时间戳 | `text-slate-500` |

---

### 2.2 字体排印体系 (Typography Scale)

- **英文字符与数据指标**：`Space Grotesk`, `ui-sans-serif`, sans-serif（充满几何张力）
- **中文字符**：`PingFang SC`, `HarmonyOS Sans`, `Microsoft YaHei`, sans-serif
- **等宽代码/学号**：`JetBrains Mono`, `Fira Code`, monospace

| 级别 | 字体大小 | 行高 | 字重 | 应用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **Display (KPI/Hero)** | 32px (`text-3xl`) ~ 36px | 1.2 | Bold (700) | 管理端大盘数字、首页焦点 Banner 标题 |
| **H1 (Page Title)** | 22px (`text-2xl`) ~ 24px | 1.25 | Bold (700) | 页面大标题（如「报名审核中心」、「社团总览库」） |
| **H2 (Section Title)**| 18px (`text-lg`) ~ 20px | 1.3 | Bold (700) | 模块卡片标题、弹窗标题、社团名称 |
| **H3 (Subhead)** | 15px ~ 16px (`text-base`) | 1.4 | SemiBold (600) | 活动标题、表格表头 TH、当前选中学员姓名 |
| **Body (Default)** | 13px ~ 14px (`text-sm`) | 1.5 | Regular (400) / Medium (500) | 正文描述、表格行数据、筛选下拉框选项 |
| **Caption (Micro)** | 11px ~ 12px (`text-xs`) | 1.4 | Medium (500) | 状态胶囊 Tag、时间戳、学号/院系标注 |

---

### 2.3 边框、圆角与孟菲斯硬投影 (Borders & Shadows)

```css
/* Neo-Memphis 核心视觉 CSS 工具类 */

/* 1. 硬边框规范 */
.border-memphis {
  border: 2px solid #0F172A;
}

.border-memphis-thick {
  border: 3px solid #0F172A;
}

/* 2. 圆角体系 */
.rounded-memphis-sm { border-radius: 6px; }   /* 胶囊标签、小按钮 */
.rounded-memphis-md { border-radius: 10px; }  /* 普通卡片、输入框、表格行 */
.rounded-memphis-lg { border-radius: 16px; }  /* 主模块容器、移动端大卡片 */
.rounded-memphis-full { border-radius: 9999px; } /* 药丸筛选条、头像 */

/* 3. 孟菲斯硬投影（无模糊，实心偏移） */
.shadow-memphis-xs {
  box-shadow: 1px 1px 0px #0F172A;
}

.shadow-memphis-sm {
  box-shadow: 2px 2px 0px #0F172A;
}

.shadow-memphis-md {
  box-shadow: 3px 3px 0px #0F172A;
}

.shadow-memphis-lg {
  box-shadow: 4px 4px 0px #0F172A;
}

/* 4. 按下/交互微动反馈 (Active Press State) */
.btn-memphis:active {
  transform: translate(2px, 2px);
  box-shadow: 0px 0px 0px #0F172A;
}
```

---

## 3. 核心 UI 组件规范 (Component Library Specifications)

### 3.1 状态胶囊与徽标 (Status Badges & Chips)
- **待审核 (Pending)**：
  - 样式：`bg-[#FFD166] text-[#0F172A] border-2 border-[#0F172A] shadow-memphis-xs`
  - 内嵌小黑圆点或沙漏图标，文字单行展示。
- **已通过 / 招新中 (Approved / Recruiting)**：
  - 样式：`bg-[#06D6A0] text-[#0F172A] border-2 border-[#0F172A] shadow-memphis-xs font-bold`
  - 配以对勾 `✓` 标识。
- **已驳回 / 淘汰 (Rejected / Full)**：
  - 样式：`bg-[#FEE2E2] text-[#F43F5E] border-2 border-[#F43F5E]`
- **白名单认证徽章 (Verified Badge)**：
  - 样式：`bg-[#E0F2FE] text-[#0284C7] border border-[#0284C7] rounded-full text-xs px-2 py-0.5`
  - 放置于学生姓名右侧，同排水平对齐。

### 3.2 按钮体系 (Buttons)
1. **主行动点按钮 (Primary CTA)**：
   - 结构：`bg-[#2F80ED] text-white font-bold border-2 border-[#0F172A] rounded-memphis-md shadow-memphis-sm`
   - 悬停/点击态：背景转 `#1D68D8`，点击位移 `translate(2px, 2px)`。
2. **通过操作按钮 (Approve Action)**：
   - 结构：`bg-[#06D6A0] hover:bg-[#05B587] text-[#0F172A] border-2 border-[#0F172A] px-3 py-1 font-bold rounded-md shadow-memphis-xs`
3. **拒绝/驳回按钮 (Reject Action)**：
   - 结构：`bg-white hover:bg-[#FEE2E2] text-[#F43F5E] border-2 border-[#0F172A] px-3 py-1 font-bold rounded-md shadow-memphis-xs`
4. **轻量次级按钮 (Ghost / Outline)**：
   - 结构：`bg-white text-[#0F172A] border-2 border-[#0F172A] hover:bg-slate-50`

### 3.3 桌面端中后台表格排版规范 (Admin Data Table Standard)
根据真实开发踩坑与优化记录，中后台表格**必须执行以下排版铁律**：
- **禁止竖排挤压**：表头 `<th class="whitespace-nowrap">`，单元格主体容器内禁止单字强制折行。
- **水平弹性架构**：
  ```html
  <!-- 示例：报名人与认证列（水平单行平铺结构） -->
  <div class="flex items-center gap-3 whitespace-nowrap">
    <div class="w-9 h-9 rounded-full bg-blue-100 border-2 border-[#0F172A] flex items-center justify-center font-bold text-[#0F172A]">
      林
    </div>
    <div class="flex flex-col">
      <div class="flex items-center gap-2">
        <span class="font-bold text-[#0F172A] text-sm">林晨</span>
        <span class="px-2 py-0.5 rounded-full text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-500 font-medium">白名单已认证</span>
      </div>
      <span class="text-xs text-slate-500 mt-0.5">软件学院 · 22级软工2班</span>
    </div>
  </div>
  ```
- **所属社团与分类**：社团名居左，右侧紧贴 `[学术科技]` 灰色/浅蓝小药丸标签，呈单行横向并排。
- **报名时间**：日期与时间采用单行 `2025-04-17 14:22`，相对时间 `(45分钟前)` 次级浅色跟随。

---

## 4. 前端工程化落地指引 (Frontend Implementation Guide)

### 4.1 Tailwind CSS 配置 (`tailwind.config.js`)
为保证前端工程直接复用设计规范，建议配置如下主题扩展：

```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        canvas: '#F8F9FF',
        primary: {
          DEFAULT: '#2F80ED',
          hover: '#1D68D8',
          light: '#EFF4FF',
        },
        memphis: {
          dark: '#0F172A',
          yellow: '#FFD166',
          green: '#06D6A0',
          red: '#F43F5E',
          cyan: '#0EA5E9',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"PingFang SC"', '"HarmonyOS Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'memphis-xs': '1px 1px 0px #0F172A',
        'memphis-sm': '2px 2px 0px #0F172A',
        'memphis-md': '3px 3px 0px #0F172A',
        'memphis-lg': '4px 4px 0px #0F172A',
      },
      borderWidth: {
        '3': '3px',
      }
    },
  },
  plugins: [],
}
```

### 4.2 移动端 uni-app 跨端样式要点
1. **单位换算**：小程序端采用 `rpx`（750rpx 设计稿标准）。
   - 硬轮廓边框：`border: 4rpx solid #0F172A;`
   - 阴影：`box-shadow: 4rpx 4rpx 0rpx #0F172A;`
2. **安全区适配**：
   - 顶部导航栏避开微信胶囊按钮（`padding-top: var(--status-bar-height)`）；
   - 底部自定义 TabBar 必须注入底部安全区距离（`padding-bottom: constant(safe-area-inset-bottom); padding-bottom: env(safe-area-inset-bottom);`）。
3. **空态与失败提示插画规范**：
   - 统一使用几何波点底纹圆形（48px~64px）+ 黑色硬线条线条图标 +「暂无内容」黄色小胶囊提示。

---

## 5. 页面与交互状态机对照 (UI States Matrix)

| 业务场景 | 默认态 (Default) | 加载态 (Loading) | 空数据态 (Empty) | 异常/驳回态 (Error) |
| :--- | :--- | :--- | :--- | :--- |
| **学生端活动报名** | 蓝色「立即报名」CTA | 按钮内 Spinner +「提交中」 | 已满员转「进入候补池」| 珊瑚红「已被驳回 (附理由)」 |
| **学生端签到** | 动态 60 秒刷新二维码 | 骨架脉冲波形 | 不在签到时段 | 定位超出范围 / 口令错误提示 |
| **管理端审核表格** | 白底斑马纹，硬黑线分割 | 表格整行骨架淡灰条 | 居中孟菲斯大眼睛图标+提示 | 红色提示条浮窗 (Toast) |
| **招新多轮面试** | 黄色「待安排面试」标签 | 异步批量通知中 | 暂无投递意向 | 淘汰归档，文字置灰带删除线 |

---

这份规范可作为后续前端工程师、UI 设计师以及组件库封装的核心输入依据。各页面开发时严格导入上述颜色、投影与排版规则即可确保全平台设计的一致性。
