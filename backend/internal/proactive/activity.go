package proactive

import (
	"hash/fnv"
	"strconv"
	"time"
)

// 状态卡「在做什么」：按本地时段 × 当日心情气质从代码模板里选一句。
// 不调模型、不落库；同一关系同一天同一时段结果固定。

const (
	vibeActive = "active" // 开心 / 黏人 / 好奇 / 得意
	vibeCalm   = "calm"   // 懒洋洋 / 想独处
	vibeLow    = "low"    // 有点累 / 有点烦 / 困
)

var activityVibeClass = map[string]string{
	"开心": vibeActive, "黏人": vibeActive, "好奇": vibeActive, "得意": vibeActive,
	"懒洋洋": vibeCalm, "想独处": vibeCalm,
	"有点累": vibeLow, "有点烦": vibeLow, "困": vibeLow,
}

// activityLines 的键是时段（早 05–11、午 11–17、晚 17–22、夜 22–05）再按气质分组。
var activityLines = map[string]map[string][]string{
	"早": {
		vibeActive: {"在翻今天想做的事", "刚泡好一杯热饮", "在窗边看早上的光"},
		vibeCalm:   {"慢悠悠地吃早饭", "还窝在被子里赖一会儿", "在发呆醒神"},
		vibeLow:    {"在努力醒过来", "刚起床，还没完全开机", "在和闹钟讲和"},
	},
	"午": {
		vibeActive: {"在整理照片", "在试一首新歌", "在翻一本没看完的书"},
		vibeCalm:   {"窝在沙发上", "在阳台晒太阳", "在慢慢喝茶"},
		vibeLow:    {"在趴着歇一会儿", "在找个角落补电", "在对着窗外放空"},
	},
	"晚": {
		vibeActive: {"在琢磨晚饭吃什么", "在收拾房间听歌", "在看一部电影的开头"},
		vibeCalm:   {"在沙发上刷剧", "在厨房慢慢煮东西", "在看天色一点点暗下来"},
		vibeLow:    {"在发呆放松", "刚吃完饭，不想动", "在盯着屏幕走神"},
	},
	"夜": {
		vibeActive: {"在翻今天拍的照片", "在写点东西", "还没睡，在听歌"},
		vibeCalm:   {"在床上看闲书", "在安静地听雨声", "在关灯前整理心情"},
		vibeLow:    {"困得睁不开眼", "在床上打滚", "在撑着不睡"},
	},
}

// Period 返回本地时段名：早、午、晚、夜。
func Period(now time.Time, loc *time.Location) string {
	if loc == nil {
		loc = shanghai
	}
	switch hour := now.In(loc).Hour(); {
	case hour >= 5 && hour < 11:
		return "早"
	case hour >= 11 && hour < 17:
		return "午"
	case hour >= 17 && hour < 22:
		return "晚"
	default:
		return "夜"
	}
}

// Activity 用 relationshipID + 本地日期 + 时段做确定性选择。未知 vibe 按平静处理。
func Activity(relationshipID int64, now time.Time, loc *time.Location, vibe string) string {
	if loc == nil {
		loc = shanghai
	}
	period := Period(now, loc)
	class, ok := activityVibeClass[vibe]
	if !ok {
		class = vibeCalm
	}
	lines := activityLines[period][class]
	h := fnv.New64a()
	_, _ = h.Write([]byte(strconv.FormatInt(relationshipID, 10) + "|" + now.In(loc).Format("2006-01-02") + "|" + period))
	return lines[int(h.Sum64()%uint64(len(lines)))]
}
