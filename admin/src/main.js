import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as Pinia from 'pinia'
import App from './App.vue'
import router from './router'
import 'material-symbols'
import 'element-plus/dist/index.css'
import './styles/index.css'
import './styles/element-override.css'

const app = createApp(App)
app.use(Pinia.createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')