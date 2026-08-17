/*
 * 冰箱助手 · 墨水屏库存看板(ESP32)
 *
 * 功能:
 *  - 每小时定时唤醒 + 冰箱门磁触发唤醒(可选)
 *  - 从云端拉取家庭共享库存(GET /api/sync?code=家庭共享码)
 *  - 墨水屏显示菜品列表,按剩余天数排序,临期(≤2天)反色高亮
 *  - 深度睡眠省电,电池供电续航以月计
 *
 * 依赖库(Arduino IDE 库管理器安装):
 *  - GxEPD2            (墨水屏驱动)
 *  - U8g2_for_Adafruit_GFX (中文字体渲染)
 *  - ArduinoJson       (v7)
 *
 * 开发板:ESP32-S3 Dev Module(其他 ESP32 需调整引脚)
 * 接线与购件清单见 hardware/README.md
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <GxEPD2_BW.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <time.h>

// ================= 配置区(按自己的情况修改) =================
const char* WIFI_SSID   = "你的WiFi名称";
const char* WIFI_PASS   = "你的WiFi密码";
// 你部署的地址,不带末尾斜杠,如 https://refrigerator-assistant.xxx.workers.dev
const char* SERVER_HOST = "https://你的域名";
const char* FAMILY_CODE = "你的家庭共享码";

const uint64_t SLEEP_SECONDS = 3600; // 定时刷新间隔(秒)
#define USE_DOOR_SENSOR 1            // 没接门磁改成 0
#define DOOR_PIN GPIO_NUM_4          // 门磁一端接 GPIO4,另一端接 GND

// 墨水屏 SPI 接线(ESP32-S3)
#define EPD_BUSY 7
#define EPD_RST  8
#define EPD_DC   9
#define EPD_CS   10
#define EPD_CLK  12
#define EPD_DIN  11
// ============================================================

// 4.2 寸黑白屏按控制器型号二选一(购买时问客服;刷不出图就换另一行):
GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT>
    display(GxEPD2_420_GDEY042T81(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)); // SSD1683,2023 年后的新屏
// GxEPD2_BW<GxEPD2_420, GxEPD2_420::HEIGHT>
//     display(GxEPD2_420(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));         // UC8176,旧款屏

U8G2_FOR_ADAFRUIT_GFX u8g2;

struct FoodItem {
  String name;
  int remaining; // 剩余天数,负数为已过期
};
FoodItem foods[24];
int foodCount = 0;

void setup() {
  Serial.begin(115200);

#if USE_DOOR_SENSOR
  pinMode(DOOR_PIN, INPUT_PULLUP);
  // 如果是开门触发唤醒:等门关上再刷新,并多等几秒让家人用手机/语音记完账
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0) {
    unsigned long waitStart = millis();
    while (digitalRead(DOOR_PIN) == HIGH && millis() - waitStart < 90000) {
      delay(200); // 门还开着
    }
    delay(8000); // 等云端同步
  }
#endif

  if (connectWiFi()) {
    syncClock();
    if (fetchInventory()) {
      renderInventory();
    } else {
      renderMessage("数据拉取失败", "检查服务地址和家庭共享码");
    }
  } else {
    renderMessage("WiFi 连接失败", "检查配置后按 RST 重试");
  }

  goToSleep();
}

void loop() {} // 全部逻辑在 setup 中完成后深度睡眠,不会进入 loop

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
  }
  return WiFi.status() == WL_CONNECTED;
}

void syncClock() {
  configTime(8 * 3600, 0, "ntp.aliyun.com", "pool.ntp.org"); // 东八区
  time_t now = 0;
  unsigned long start = millis();
  while (now < 1600000000 && millis() - start < 8000) {
    delay(200);
    now = time(nullptr);
  }
}

/** 拉取家庭库存并解析 */
bool fetchInventory() {
  WiFiClientSecure client;
  client.setInsecure(); // 家用场景省去证书校验
  HTTPClient http;
  String url = String(SERVER_HOST) + "/api/sync?code=" + FAMILY_CODE;
  if (!http.begin(client, url)) return false;
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }
  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return false;

  time_t now = time(nullptr);
  struct tm nowTm;
  localtime_r(&now, &nowTm);
  nowTm.tm_hour = 12; nowTm.tm_min = 0; nowTm.tm_sec = 0; // 按自然日比较
  time_t todayNoon = mktime(&nowTm);

  foodCount = 0;
  for (JsonObject item : doc["items"].as<JsonArray>()) {
    if (foodCount >= 24) break;
    const char* name = item["name"];
    const char* expire = item["expireDate"]; // YYYY-MM-DD
    if (!name || !expire || strlen(expire) < 10) continue;
    struct tm expTm = {};
    expTm.tm_year = atoi(expire) - 1900;
    expTm.tm_mon  = atoi(expire + 5) - 1;
    expTm.tm_mday = atoi(expire + 8);
    expTm.tm_hour = 12;
    time_t expNoon = mktime(&expTm);
    foods[foodCount].name = String(name);
    foods[foodCount].remaining = (int)lround(difftime(expNoon, todayNoon) / 86400.0);
    foodCount++;
  }
  // 按剩余天数从少到多排序(最急的排最上面)
  for (int i = 0; i < foodCount - 1; i++) {
    for (int j = 0; j < foodCount - 1 - i; j++) {
      if (foods[j].remaining > foods[j + 1].remaining) {
        FoodItem t = foods[j];
        foods[j] = foods[j + 1];
        foods[j + 1] = t;
      }
    }
  }
  return true;
}

void initDisplay() {
  SPI.begin(EPD_CLK, -1, EPD_DIN, EPD_CS);
  display.init(115200, true, 2, false);
  display.setRotation(0); // 400x300 横屏
  u8g2.begin(display);
  u8g2.setFontMode(1);
  u8g2.setFontDirection(0);
}

/** 主界面:标题 + 菜品列表(最多 9 行)+ 底部更新时间 */
void renderInventory() {
  initDisplay();
  int expiringCount = 0;
  for (int i = 0; i < foodCount; i++) {
    if (foods[i].remaining <= 2) expiringCount++;
  }

  time_t now = time(nullptr);
  struct tm nowTm;
  localtime_r(&now, &nowTm);
  char footer[64];
  snprintf(footer, sizeof(footer), "%02d:%02d 更新 · 共%d样 · 临期%d样",
           nowTm.tm_hour, nowTm.tm_min, foodCount, expiringCount);

  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);

    // 标题栏
    u8g2.setFont(u8g2_font_wqy16_t_gb2312);
    u8g2.setForegroundColor(GxEPD_BLACK);
    u8g2.setBackgroundColor(GxEPD_WHITE);
    u8g2.setCursor(12, 24);
    u8g2.print("冰箱库存");
    display.drawLine(0, 34, 400, 34, GxEPD_BLACK);

    // 菜品行
    u8g2.setFont(u8g2_font_wqy14_t_gb2312);
    int y = 58;
    int shown = foodCount < 9 ? foodCount : 9;
    for (int i = 0; i < shown; i++) {
      bool urgent = foods[i].remaining <= 2;
      char days[24];
      if (foods[i].remaining < 0) {
        snprintf(days, sizeof(days), "过期%d天", -foods[i].remaining);
      } else if (foods[i].remaining == 0) {
        snprintf(days, sizeof(days), "今天到期");
      } else {
        snprintf(days, sizeof(days), "剩%d天", foods[i].remaining);
      }
      if (urgent) {
        display.fillRoundRect(6, y - 16, 388, 24, 4, GxEPD_BLACK);
        u8g2.setForegroundColor(GxEPD_WHITE);
        u8g2.setBackgroundColor(GxEPD_BLACK);
      } else {
        u8g2.setForegroundColor(GxEPD_BLACK);
        u8g2.setBackgroundColor(GxEPD_WHITE);
      }
      u8g2.setCursor(14, y + 4);
      u8g2.print(foods[i].name);
      u8g2.setCursor(400 - 14 - u8g2.getUTF8Width(days), y + 4);
      u8g2.print(days);
      y += 27;
    }
    if (foodCount == 0) {
      u8g2.setCursor(140, 150);
      u8g2.print("冰箱是空的");
    }
    if (foodCount > 9) {
      u8g2.setForegroundColor(GxEPD_BLACK);
      u8g2.setBackgroundColor(GxEPD_WHITE);
      u8g2.setCursor(14, y + 4);
      char more[32];
      snprintf(more, sizeof(more), "…还有%d样,手机上查看", foodCount - 9);
      u8g2.print(more);
    }

    // 底部状态栏
    display.drawLine(0, 278, 400, 278, GxEPD_BLACK);
    u8g2.setFont(u8g2_font_wqy12_t_gb2312);
    u8g2.setForegroundColor(GxEPD_BLACK);
    u8g2.setBackgroundColor(GxEPD_WHITE);
    u8g2.setCursor(12, 294);
    u8g2.print(footer);
  } while (display.nextPage());
  display.hibernate();
}

void renderMessage(const char* line1, const char* line2) {
  initDisplay();
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    u8g2.setFont(u8g2_font_wqy16_t_gb2312);
    u8g2.setForegroundColor(GxEPD_BLACK);
    u8g2.setBackgroundColor(GxEPD_WHITE);
    u8g2.setCursor(80, 130);
    u8g2.print(line1);
    u8g2.setFont(u8g2_font_wqy14_t_gb2312);
    u8g2.setCursor(80, 165);
    u8g2.print(line2);
  } while (display.nextPage());
  display.hibernate();
}

void goToSleep() {
  esp_sleep_enable_timer_wakeup(SLEEP_SECONDS * 1000000ULL);
#if USE_DOOR_SENSOR
  // 门打开(磁铁离开,引脚被拉高)时唤醒
  esp_sleep_enable_ext0_wakeup(DOOR_PIN, 1);
#endif
  Serial.println("进入深度睡眠");
  esp_deep_sleep_start();
}
