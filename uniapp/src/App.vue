<script>
import { login } from '@/api/user'
import { useUserStore } from '@/store/user'

export default {
  async onLaunch() {
    const userStore = useUserStore()
    userStore.restore()
    // 小程序打开即建立未认证的游客会话，游客仍可浏览所有公开内容。
    // #ifdef MP-WEIXIN
    if (!userStore.hasSession) {
      try {
        const result = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
        const response = await login({ code: result.code, platform: 'mp-weixin' })
        if (response.code === 0) {
          userStore.setLogin({
            token: response.data.token,
            refresh_token: response.data.refresh_token,
            userInfo: response.data.user,
            authStatus: response.data.authStatus,
          })
        }
      } catch (e) {
        // 授权失败保留纯游客态，后续进入登录页可以再次尝试。
      }
    }
    // #endif
  },
}
</script>

<style lang="scss">
/* 全局引入 Neo-Memphis 主题 CSS 变量与安全区工具类（P0-02） */
@import '@/styles/theme.css';

/* 全局公共样式（P0-02：完整设计令牌见 uni.scss 与 styles/theme.css） */
page {
  background-color: $color-bg-canvas;
  color: $color-text-title;
  font-family: $font-sans;
}

/* H5 响应式适配（P1-29）：桌面浏览器把移动端优先布局限宽居中，不随窗口拉宽拉伸
 * 页面内容与底部 tabbar 同步限宽；平板/PC 两侧留 canvas 底色 */
/* #ifdef H5 */
@media (min-width: 640px) {
  uni-page-body {
    max-width: 480px;
    margin: 0 auto;
  }
  uni-tabbar {
    left: 50%;
    transform: translateX(-50%);
    max-width: 480px;
  }
}
/* #endif */
</style>
