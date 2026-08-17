/**
 * 内置家常菜谱库 + 按库存匹配推荐。
 * P1 接入 LLM 后,本模块可作为无网络时的兜底方案。
 */
const RECIPES = [
  { name: '西红柿炒鸡蛋', time: '10 分钟', ingredients: ['西红柿', '鸡蛋'], brief: '西红柿去皮切块,鸡蛋炒至半凝固盛出,炒软西红柿后回锅同炒' },
  { name: '青椒肉丝', time: '15 分钟', ingredients: ['青椒', '猪肉'], brief: '肉丝用生抽淀粉腌 10 分钟,滑炒变色后下青椒丝大火快炒' },
  { name: '酸辣土豆丝', time: '10 分钟', ingredients: ['土豆', '青椒'], brief: '土豆切丝泡水去淀粉,热油下干辣椒,大火快炒后淋醋出锅' },
  { name: '蒜蓉菠菜', time: '5 分钟', ingredients: ['菠菜', '蒜'], brief: '蒜末爆香,菠菜大火快炒 1 分钟,加盐即可' },
  { name: '黄瓜炒蛋', time: '8 分钟', ingredients: ['黄瓜', '鸡蛋'], brief: '黄瓜切片,鸡蛋先炒盛出,黄瓜断生后回锅同炒' },
  { name: '麻婆豆腐', time: '15 分钟', ingredients: ['豆腐', '猪肉'], brief: '肉末煸香加豆瓣酱,下豆腐块小火烧 5 分钟,勾芡撒花椒粉' },
  { name: '番茄豆腐汤', time: '15 分钟', ingredients: ['西红柿', '豆腐'], brief: '西红柿炒出沙加水,下豆腐块煮 5 分钟,调味撒葱花' },
  { name: '土豆炖牛肉', time: '60 分钟', ingredients: ['牛肉', '土豆', '胡萝卜'], brief: '牛肉焯水炖 40 分钟,加土豆胡萝卜再炖 20 分钟收汁' },
  { name: '香菇青菜', time: '8 分钟', ingredients: ['香菇', '上海青'], brief: '香菇切片炒香,下青菜大火快炒,蚝油调味' },
  { name: '韭菜炒蛋', time: '8 分钟', ingredients: ['韭菜', '鸡蛋'], brief: '鸡蛋炒至凝固,下韭菜段快炒 30 秒立即出锅' },
  { name: '黄焖鸡', time: '30 分钟', ingredients: ['鸡肉', '土豆', '青椒'], brief: '鸡块煸炒上色,加生抽老抽和水焖 20 分钟,下土豆青椒焖软' },
  { name: '清炒西兰花', time: '8 分钟', ingredients: ['西兰花', '蒜'], brief: '西兰花焯水 1 分钟,蒜末爆香后大火快炒,盐和少许糖调味' },
  { name: '白萝卜排骨汤', time: '60 分钟', ingredients: ['白萝卜', '猪肉'], brief: '排骨焯水炖 40 分钟,下萝卜块再炖 20 分钟,盐调味' },
  { name: '蒜蓉茄子', time: '15 分钟', ingredients: ['茄子', '蒜'], brief: '茄子蒸 8 分钟撕条,热油泼蒜末,加生抽香醋拌匀' },
  { name: '芹菜炒肉', time: '12 分钟', ingredients: ['芹菜', '猪肉'], brief: '肉片滑炒变色盛出,芹菜段断生后回锅,盐调味' },
  { name: '金针菇肥牛', time: '15 分钟', ingredients: ['金针菇', '牛肉'], brief: '金针菇垫底,牛肉片焯水铺上,淋蒜末小米辣热油和生抽蒸 5 分钟' },
  { name: '胡萝卜炒蛋', time: '8 分钟', ingredients: ['胡萝卜', '鸡蛋'], brief: '胡萝卜擦丝炒软,倒入蛋液炒至凝固,盐调味' },
  { name: '虾仁豆腐', time: '15 分钟', ingredients: ['虾', '豆腐'], brief: '虾仁滑炒变色,下豆腐块轻推烧 3 分钟,勾薄芡' },
];

/**
 * 库存名与菜谱食材的模糊匹配:互相包含即视为同一食材
 * (库存“小土豆”匹配食材“土豆”)。
 */
function matchStock(stockNames, ingredient) {
  return stockNames.find((n) => n.includes(ingredient) || ingredient.includes(n)) || null;
}

/**
 * 按当前库存推荐菜谱。
 * @param {string[]} stockNames    库存菜品名
 * @param {string[]} expiringNames 临期/过期菜品名(优先消耗)
 * @returns 推荐列表,每项含 have(已有食材)/missing(缺料)/usesExpiring
 */
function recommend(stockNames, expiringNames, limit) {
  const results = RECIPES.map((recipe) => {
    const have = [];
    const missing = [];
    let expiringCount = 0;
    recipe.ingredients.forEach((ing) => {
      const hit = matchStock(stockNames, ing);
      if (hit) {
        have.push(ing);
        if (matchStock(expiringNames, ing)) expiringCount += 1;
      } else {
        missing.push(ing);
      }
    });
    // 得分 = 食材齐全度 + 临期消耗加成;一样食材都没有的不推荐
    const score = have.length / recipe.ingredients.length + expiringCount * 0.6;
    return {
      name: recipe.name,
      time: recipe.time,
      brief: recipe.brief,
      have,
      missing,
      usesExpiring: expiringCount > 0,
      score,
    };
  })
    .filter((r) => r.have.length > 0)
    .sort((a, b) => b.score - a.score);

  return results.slice(0, limit || 5);
}

export { RECIPES, recommend };
