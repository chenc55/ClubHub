<script>
/**
 * 静态富文本页（隐私政策 / 用户协议 / 关于 / P1-24 + 8.4）
 * 通过 query.type 区分：privacy | agreement | about
 */
const CONTENT = {
  privacy: {
    title: '隐私政策',
    sections: [
      { h: '一、信息收集范围（最小化收集）', body: '我们仅收集为你提供服务所必需的信息，包括：微信昵称与头像（用于展示）；学号、姓名、学院、专业（用于校内学号认证与社团管理）；报名 / 签到 / 招新等业务记录（用于活动运营）。我们不会收集与你无关的个人信息。' },
      { h: '二、脱敏展示', body: '在消息列表、报名名单、成员管理等场景中，学号一律脱敏展示（如 2021****34）；完整学号仅平台管理员与认证本人可见。' },
      { h: '三、信息使用与保存', body: '你的信息仅用于校园社团服务，不以任何形式出售或对外提供（法律法规另有规定的除外）。你注销账号后，我们将依法删除或匿名化处理你的个人信息。' },
      { h: '四、你的权利', body: '你可以查看和更正你的个人资料；如对信息处理有异议，可在「设置-换绑申诉」中提交申诉，我们会尽快处理。' },
    ],
  },
  agreement: {
    title: '用户协议',
    sections: [
      { h: '一、服务说明', body: '社团星球（ClubHub）面向在校学生提供社团信息、活动报名、招新报名与社团管理等校园服务，平台由校内运营方维护。' },
      { h: '二、用户行为规范', body: '你应使用真实学号完成认证，保证报名 / 签到信息的真实性；不得利用平台从事违反法律法规或校规的行为，包括但不限于刷票、代签、发布违规内容等。' },
      { h: '三、社团内容', body: '社团发布的介绍、活动、招新及动态内容由社团负责人负责；平台对内容进行审核与监管，发现违规将予以下架或封禁。' },
      { h: '四、服务变更与终止', body: '平台可能因运营需要调整或终止部分功能，变更前将通过公告 / 站内消息通知；你违反协议情节严重的，平台有权暂停或终止你的账号使用。' },
    ],
  },
  about: {
    title: '关于我们',
    sections: [
      { h: '社团星球 · ClubHub', body: '面向单所高校的校园社团一站式综合服务平台，覆盖「社团信息 → 活动报名 → 招新纳新 → 社团管理」全链路，帮助提升校园活动运营效率。' },
      { h: '联系方式', body: '如遇问题，可通过「设置-换绑申诉」提交申诉，或联系平台管理员（团委 / 校社联）。' },
      { h: '版本', body: 'v1.0（2026 秋季学期）· uniCloud 云端驱动' },
    ],
  },
}

export default {
  name: 'StaticPage',

  data: () => ({
    title: '静态页',
    sections: [],
  }),

  onLoad(query) {
    const conf = CONTENT[query.type] || CONTENT.about
    this.title = conf.title
    this.sections = conf.sections
  },
}
</script>

<template>
  <view class="sp-page">
    <view class="sp-card">
      <text class="sp-card__title">{{ title }}</text>
      <view v-for="(s, index) in sections" :key="index" class="sp-section">
        <text class="sp-section__head">{{ s.h }}</text>
        <text class="sp-section__body">{{ s.body }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sp-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.sp-card {
  margin-top: 24rpx;
  padding: 36rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.sp-card__title {
  display: block;
  font-size: $fs-h1;
  font-weight: 700;
  color: $color-text-title;
}

.sp-section {
  margin-top: 28rpx;

  &:first-of-type {
    margin-top: 24rpx;
  }

  &__head {
    display: block;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__body {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-body;
    line-height: 1.7;
    color: $color-text-body;
  }
}
</style>