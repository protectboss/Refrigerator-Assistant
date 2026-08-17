/**
 * 保质期知识库:录入菜品时按名称自动带出
 * 保存位置、参考保质期(天)和保存建议,均可被用户手动覆盖。
 * days 以“放入冰箱/家中当天”起算的常见家庭参考值。
 */
const KNOWLEDGE = [
  // ---- 叶菜类(短保,优先吃) ----
  { name: '菠菜', category: '叶菜', location: '冷藏', days: 4, advice: '厨房纸包裹后装保鲜袋冷藏,叶片沾水易烂' },
  { name: '生菜', category: '叶菜', location: '冷藏', days: 5, advice: '整颗带根冷藏更耐放,吃前再洗' },
  { name: '油麦菜', category: '叶菜', location: '冷藏', days: 4, advice: '厨房纸包裹装袋冷藏,尽快食用' },
  { name: '小白菜', category: '叶菜', location: '冷藏', days: 4, advice: '装保鲜袋冷藏,叶片易黄化,优先吃' },
  { name: '上海青', category: '叶菜', location: '冷藏', days: 4, advice: '装保鲜袋冷藏,优先食用' },
  { name: '韭菜', category: '叶菜', location: '冷藏', days: 4, advice: '用纸包好再装袋,避免压伤,气味重建议密封' },
  { name: '香菜', category: '叶菜', location: '冷藏', days: 5, advice: '根部朝下插水杯或纸包冷藏' },
  { name: '芹菜', category: '叶菜', location: '冷藏', days: 7, advice: '切段泡水冷藏可保脆,或用锡纸整根包裹' },
  { name: '白菜', category: '叶菜', location: '冷藏', days: 14, advice: '整颗用纸包好,冬季阴凉处也可存放' },
  { name: '包菜', category: '叶菜', location: '冷藏', days: 12, advice: '整颗冷藏,切开后切面覆膜尽快吃完' },
  { name: '西兰花', category: '叶菜', location: '冷藏', days: 5, advice: '不要水洗直接装袋冷藏,发黄前吃完' },
  { name: '花菜', category: '叶菜', location: '冷藏', days: 6, advice: '装保鲜袋冷藏,出现黑点尽快食用' },

  // ---- 根茎瓜果类 ----
  { name: '土豆', category: '根茎', location: '常温', days: 21, advice: '阴凉避光通风保存,不要进冰箱;发芽变绿勿食,远离洋葱存放' },
  { name: '红薯', category: '根茎', location: '常温', days: 21, advice: '阴凉干燥处常温保存,冷藏反而易坏' },
  { name: '胡萝卜', category: '根茎', location: '冷藏', days: 18, advice: '去掉缨叶后装袋冷藏,带缨会加速失水' },
  { name: '白萝卜', category: '根茎', location: '冷藏', days: 14, advice: '去缨后用保鲜膜包裹冷藏' },
  { name: '莲藕', category: '根茎', location: '冷藏', days: 7, advice: '带泥保存更久,洗净后需泡水冷藏并每日换水' },
  { name: '山药', category: '根茎', location: '常温', days: 14, advice: '整根阴凉处存放,切开后切面覆膜冷藏 3 天内吃完' },
  { name: '洋葱', category: '根茎', location: '常温', days: 30, advice: '干燥通风处存放,远离土豆;切开后装盒冷藏' },
  { name: '西红柿', category: '瓜果', location: '常温', days: 5, advice: '未全熟常温放熟,熟透后可冷藏但风味略降' },
  { name: '黄瓜', category: '瓜果', location: '冷藏', days: 6, advice: '擦干装袋冷藏,别贴冷藏室后壁以免冻伤' },
  { name: '青椒', category: '瓜果', location: '冷藏', days: 7, advice: '擦干装保鲜袋冷藏,避免受潮' },
  { name: '茄子', category: '瓜果', location: '常温', days: 4, advice: '常温阴凉保存即可,冷藏易长褐斑' },
  { name: '西葫芦', category: '瓜果', location: '冷藏', days: 6, advice: '整根装袋冷藏,切开后尽快吃完' },
  { name: '豆角', category: '瓜果', location: '冷藏', days: 5, advice: '装袋冷藏;焯水后冷冻可存 2 个月' },
  { name: '冬瓜', category: '瓜果', location: '常温', days: 30, advice: '整只常温可久放;切开后去瓤覆膜冷藏 3 天内吃完' },
  { name: '南瓜', category: '瓜果', location: '常温', days: 30, advice: '整只阴凉处久放;切开后覆膜冷藏尽快食用' },
  { name: '玉米', category: '瓜果', location: '冷藏', days: 3, advice: '带皮冷藏,甜度流失快;煮熟冷冻可存 1 个月' },

  // ---- 菌菇类 ----
  { name: '蘑菇', category: '菌菇', location: '冷藏', days: 4, advice: '纸袋或厨房纸包裹冷藏,塑料袋闷放易出水变黏' },
  { name: '香菇', category: '菌菇', location: '冷藏', days: 5, advice: '纸包冷藏防潮,表面发黏就不要吃了' },
  { name: '金针菇', category: '菌菇', location: '冷藏', days: 4, advice: '原包装冷藏,开封后尽快食用' },
  { name: '杏鲍菇', category: '菌菇', location: '冷藏', days: 6, advice: '纸包或原包装冷藏' },

  // ---- 肉禽水产(短保,尽快吃或冷冻) ----
  { name: '猪肉', category: '肉类', location: '冷藏', days: 2, advice: '冷藏 1-2 天内烹饪;按顿分装冷冻可存 3-6 个月' },
  { name: '牛肉', category: '肉类', location: '冷藏', days: 2, advice: '冷藏尽快烹饪;分装冷冻可存 6 个月' },
  { name: '羊肉', category: '肉类', location: '冷藏', days: 2, advice: '冷藏尽快烹饪;分装冷冻可存 6 个月' },
  { name: '鸡肉', category: '肉类', location: '冷藏', days: 2, advice: '冷藏 1-2 天内烹饪,生熟分开;冷冻可存 3 个月' },
  { name: '鱼', category: '水产', location: '冷藏', days: 1, advice: '处理干净当天或次日烹饪;冷冻可存 2-3 个月' },
  { name: '虾', category: '水产', location: '冷冻', days: 60, advice: '鲜虾当天吃,吃不完直接冷冻保存' },

  // ---- 蛋奶豆制品 ----
  { name: '鸡蛋', category: '蛋奶', location: '冷藏', days: 28, advice: '尖头朝下冷藏,别放冰箱门架(温度波动大),不要水洗' },
  { name: '牛奶', category: '蛋奶', location: '冷藏', days: 5, advice: '开封后冷藏并 3-5 天内喝完,以包装标注为准' },
  { name: '豆腐', category: '豆制品', location: '冷藏', days: 2, advice: '开盒后泡清水冷藏并每日换水,极易变质' },
  { name: '豆芽', category: '豆制品', location: '冷藏', days: 2, advice: '装袋冷藏,最好当天吃完' },
  { name: '豆干', category: '豆制品', location: '冷藏', days: 4, advice: '密封冷藏,出现黏液勿食' },

  // ---- 调味与其他 ----
  { name: '葱', category: '调味', location: '冷藏', days: 10, advice: '切段擦干装盒冷藏;切葱花冷冻随取随用' },
  { name: '姜', category: '调味', location: '常温', days: 21, advice: '阴凉干燥处保存;切块冷冻可放更久' },
  { name: '蒜', category: '调味', location: '常温', days: 30, advice: '干燥通风网袋存放,避免受潮发芽' },
  { name: '剩菜', category: '熟食', location: '冷藏', days: 2, advice: '放凉后密封冷藏,食用前彻底加热' },

  // ---- 水果 ----
  { name: '苹果', category: '水果', location: '冷藏', days: 21, advice: '装袋冷藏;苹果释放乙烯,与其他果蔬分开放' },
  { name: '香蕉', category: '水果', location: '常温', days: 5, advice: '常温悬挂或平放,不要冷藏(会黑皮)' },
  { name: '橙子', category: '水果', location: '常温', days: 14, advice: '常温阴凉存放,冷藏可再延长一周' },
  { name: '葡萄', category: '水果', location: '冷藏', days: 5, advice: '不要提前水洗,装袋冷藏吃前再洗' },
  { name: '草莓', category: '水果', location: '冷藏', days: 3, advice: '单层摆放不挤压,吃前再洗,极易发霉' },
];

/** 默认值:知识库没有命中时使用 */
const FALLBACK = { category: '其他', location: '冷藏', days: 7, advice: '默认冷藏 7 天,可根据实际情况修改到期日期' };

/**
 * 按名称查询知识库:先精确匹配,再互相包含匹配
 * (如“小土豆”命中“土豆”,“豆腐”命中“嫩豆腐”)。
 */
function lookup(name) {
  const key = (name || '').trim();
  if (!key) return null;
  const exact = KNOWLEDGE.find((k) => k.name === key);
  if (exact) return exact;
  return KNOWLEDGE.find((k) => key.includes(k.name) || k.name.includes(key)) || null;
}

/** 输入联想:返回名称包含关键字的知识库条目(最多 8 条) */
function suggest(keyword) {
  const key = (keyword || '').trim();
  if (!key) return [];
  return KNOWLEDGE.filter((k) => k.name.includes(key)).slice(0, 8);
}

module.exports = { KNOWLEDGE, FALLBACK, lookup, suggest };
