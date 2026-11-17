// System font presets reuse the application's local:<family> preference format.
// No font files are downloaded or bundled by selecting a preset.
const presets = [
  { family: "Microsoft YaHei", zh: "微软雅黑", aliases: ["微软雅黑", "Microsoft YaHei UI"] },
  { family: "DengXian", zh: "等线", aliases: ["等线"] },
  { family: "SimSun", zh: "宋体", aliases: ["宋体"] },
  { family: "SimHei", zh: "黑体", aliases: ["黑体"] },
  { family: "KaiTi", zh: "楷体", aliases: ["楷体"] },
  { family: "FangSong", zh: "仿宋", aliases: ["仿宋"] },
  { family: "PingFang SC", zh: "苹方", aliases: ["苹方-简", "苹方 简"] },
  { family: "Source Han Sans SC", zh: "思源黑体", aliases: ["思源黑体", "思源黑体 CN"] },
  { family: "Source Han Serif SC", zh: "思源宋体", aliases: ["思源宋体", "思源宋体 CN"] },
  { family: "Noto Sans CJK SC", zh: "Noto 中文黑体", aliases: [] },
  { family: "Noto Serif CJK SC", zh: "Noto 中文宋体", aliases: [] },
];

function normalize(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function chineseFontOptions(locale = "zh-CN") {
  const chinese = locale.toLowerCase().startsWith("zh");
  return presets.map(font => ({
    value: `local:${font.family}`,
    label: chinese ? `${font.zh} · ${font.family}` : `${font.family} · ${font.zh}`,
    group: chinese ? "中文字体" : "Chinese fonts",
  }));
}

export function isChineseFontFamily(family) {
  const name = normalize(family);
  return presets.some(font => [font.family, ...font.aliases].some(alias => normalize(alias) === name));
}

export function chineseFontCopy(locale = "zh-CN") {
  return locale.toLowerCase().startsWith("zh") ? {
    note: "中文字体使用本机字体；未安装的字体会自动回退到系统字体。浅色与深色模式分别保存。",
    previewLabel: "字体预览",
    preview: "你好，世界。让灵感成为作品。Aa 123",
  } : {
    note: "Chinese presets use local fonts and fall back to the system font when unavailable. Light and dark modes save separately.",
    previewLabel: "Font preview",
    preview: "你好，世界。让灵感成为作品。Aa 123",
  };
}
