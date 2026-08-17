const store = require('../../utils/store');

Page({
  data: {
    items: [],
    expiredCount: 0,
    expiringCount: 0,
    total: 0,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const items = store.getDecoratedItems();
    this.setData({
      items,
      total: items.length,
      expiredCount: items.filter((it) => it.level === 'expired').length,
      expiringCount: items.filter((it) => it.level === 'expiring').length,
    });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/add/add' });
  },

  onItemTap(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showActionSheet({
      alertText: name,
      itemList: ['吃完了', '扔掉了', '编辑'],
      success: (res) => {
        if (res.tapIndex === 0) {
          store.finishItem(id, 'eaten');
          wx.showToast({ title: '已吃完,真棒', icon: 'success' });
          this.refresh();
        } else if (res.tapIndex === 1) {
          store.finishItem(id, 'wasted');
          wx.showToast({ title: '已记录扔掉', icon: 'none' });
          this.refresh();
        } else if (res.tapIndex === 2) {
          wx.navigateTo({ url: `/pages/add/add?id=${id}` });
        }
      },
    });
  },
});
