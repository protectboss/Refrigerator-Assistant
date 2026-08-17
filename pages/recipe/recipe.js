const store = require('../../utils/store');
const recipes = require('../../utils/recipes');

Page({
  data: {
    recs: [],
    shopping: [],
    hasStock: false,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const items = store.getDecoratedItems();
    const stockNames = items.map((it) => it.name);
    const expiringNames = items
      .filter((it) => it.level === 'expired' || it.level === 'expiring')
      .map((it) => it.name);
    const shopping = store.getShopping();

    const recs = recipes.recommend(stockNames, expiringNames, 5).map((r) =>
      Object.assign({}, r, {
        missing: r.missing.map((name) => ({ name, inList: shopping.includes(name) })),
      })
    );

    this.setData({ recs, shopping, hasStock: items.length > 0 });
  },

  onAddShopping(e) {
    const { name, inlist } = e.currentTarget.dataset;
    if (inlist) return;
    store.addShopping(name);
    wx.showToast({ title: `${name} 已加入购物清单`, icon: 'none' });
    this.refresh();
  },

  onRemoveShopping(e) {
    const { name } = e.currentTarget.dataset;
    store.removeShopping(name);
    this.refresh();
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' });
  },
});
