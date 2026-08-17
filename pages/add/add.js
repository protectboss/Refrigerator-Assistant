const shelfLife = require('../../utils/shelfLife');
const store = require('../../utils/store');

const LOCATIONS = ['冷藏', '冷冻', '常温'];

Page({
  data: {
    editId: null,
    name: '',
    suggestions: [],
    category: '',
    locations: LOCATIONS,
    locationIndex: 0,
    expireDate: '',
    minDate: '',
    advice: '',
    kbHint: '',
    today: '',
  },

  onLoad(options) {
    const today = store.todayStr();
    this.setData({ today, minDate: today, expireDate: store.addDays(today, 7) });

    if (options.id) {
      const item = store.getItem(options.id);
      if (item) {
        wx.setNavigationBarTitle({ title: '编辑菜品' });
        this.setData({
          editId: item.id,
          name: item.name,
          category: item.category,
          locationIndex: Math.max(0, LOCATIONS.indexOf(item.location)),
          expireDate: item.expireDate,
          advice: item.advice,
          minDate: '2020-01-01',
        });
      }
    }
  },

  onNameInput(e) {
    const name = e.detail.value;
    this.kbApplied = false;
    this.setData({ name, suggestions: shelfLife.suggest(name) });
  },

  /** 失焦时尝试用知识库自动填充(手动输入完整名称的场景) */
  onNameBlur() {
    // 延迟,让联想项的 tap 事件先触发
    setTimeout(() => {
      this.setData({ suggestions: [] });
      if (!this.kbApplied && this.data.name && !this.data.editId) {
        this.applyKnowledge(shelfLife.lookup(this.data.name));
      }
    }, 200);
  },

  onSuggestionTap(e) {
    const entry = shelfLife.KNOWLEDGE.find((k) => k.name === e.currentTarget.dataset.name);
    this.setData({ name: entry.name, suggestions: [] });
    this.applyKnowledge(entry);
  },

  /** 用知识库条目填充分类、位置、到期日与保存建议 */
  applyKnowledge(entry) {
    const kb = entry || shelfLife.FALLBACK;
    this.kbApplied = !!entry;
    this.setData({
      category: kb.category,
      locationIndex: Math.max(0, LOCATIONS.indexOf(kb.location)),
      expireDate: store.addDays(store.todayStr(), kb.days),
      advice: kb.advice,
      kbHint: entry
        ? `已按知识库自动设置:${kb.location}保存约 ${kb.days} 天,到期日和建议都可以修改`
        : '知识库暂无此菜品,已按默认冷藏 7 天设置,可手动调整',
    });
  },

  onLocationChange(e) {
    this.setData({ locationIndex: Number(e.detail.value) });
  },

  onDateChange(e) {
    this.setData({ expireDate: e.detail.value });
  },

  onAdviceInput(e) {
    this.setData({ advice: e.detail.value });
  },

  onSave() {
    const { editId, name, category, locationIndex, expireDate, advice } = this.data;
    if (!name.trim()) {
      wx.showToast({ title: '请填写菜品名称', icon: 'none' });
      return;
    }
    const payload = {
      name: name.trim(),
      category: category || '其他',
      location: LOCATIONS[locationIndex],
      expireDate,
      advice: advice || '',
    };
    if (editId) {
      store.updateItem(editId, payload);
    } else {
      store.addItem(payload);
    }
    wx.showToast({ title: editId ? '已保存' : '已放入冰箱', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },
});
