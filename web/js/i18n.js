// Translations. English is the base language; zh-Hant is Traditional Chinese
// (Taiwan / Hong Kong usage). To add a language: add it to LANGS, add a block
// to STRINGS, CATALOG and STEP_TEXT, and translate every key (the tests check
// that no key is missing).

export const LANGS = [
  { code: 'en', label: 'English', sample: 'Pack my suitcase' },
  { code: 'zh-Hant', label: '繁體中文', sample: '開始打包' },
];

const STRINGS = {
  en: {
    'app.title': 'Smart Packing Assistant',
    'app.tagline': "Pick what you're bringing. We'll find the tightest, most stable way to pack it.",
    'top.install': 'Install app',
    'top.settings': 'Settings',
    'mode.server': 'Running on your computer',
    'mode.browser': 'Running in your browser',
    'mode.serverTitle': 'Packing runs in Python; saved trips are stored in data/trips.json',
    'mode.browserTitle': 'Packing runs in this browser; saved trips are stored in this browser only',

    's1.title': 'Your suitcase',
    's1.sizes': 'Suitcase size',
    's1.length': 'Length',
    's1.width': 'Width',
    's1.height': 'Height',
    's1.max': 'Max',
    's1.hint': 'Inside measurements. Edit them to match your own bag.',
    's1.colour': 'Suitcase colour',
    'unit.cm': 'cm',
    'unit.kg': 'kg',

    's2.title': 'Start from a trip',
    'trips.mine': 'My trips',
    'trips.save': 'Save current',
    'trips.share': 'Share',
    'trips.open': 'Open shared',
    'trips.copy': 'Copy',
    'trips.openBtn': 'Open',
    'trips.codeAria': 'Share code for this trip',
    'trips.codePh': 'Paste a share link or trip code',
    'trips.namePh': 'Name it, e.g. Tokyo in March',
    'trips.saveBtn': 'Save',
    'trips.cancel': 'Cancel',
    'trips.hintServer': 'Save your selection to reuse it later. Trips are kept in data/trips.json.',
    'trips.hintBrowser': 'Save your selection to reuse it later. Trips are kept in this browser.',
    'trips.count': '{n} items',
    'trips.delete': 'Delete {name}',

    's3.title': 'What are you bringing?',
    'search.ph': 'Search {n} items: shoes, laptop, towel…',
    'cat.all': 'All',
    'cat.selected': 'Selected',
    'list.yours': 'Your items',
    'list.noMatch': 'Nothing matches "{q}". Add it as your own item below.',
    'list.none': 'Nothing selected yet.',
    'item.remove': 'Remove one {name}',
    'item.add': 'Add one {name}',
    'item.pinTitle': 'Need it first: packed last, on top, easy to grab',
    'item.pinAria': 'Need {name} first',
    'tag.fragile': 'fragile',
    'tag.upright': 'upright',
    'tag.soft': 'soft',
    'tag.softTitle': 'Can be squashed by up to {n}%',

    'custom.add': '+ Add your own item',
    'custom.name': 'Name',
    'custom.namePh': 'e.g. Board game',
    'custom.weight': 'Weight kg',
    'custom.looks': 'Looks like',
    'custom.fragile': 'Fragile (nothing on top)',
    'custom.upright': 'Keep upright',
    'custom.submit': 'Add item',

    'sum.items': '{n} items',
    'sum.item': '1 item',
    'sum.weight': '{kg} kg of {max} kg',
    'sum.weightNoMax': '{kg} kg',
    'sum.clear': 'Clear',
    'sum.squeeze': 'Squeeze soft clothes if space is tight',
    'sum.pack': 'Pack my suitcase',
    'fill.empty': 'Add some items to get started.',
    'fill.overKg': 'Over the {max} kg limit, so some items will be left out.',
    'fill.over': "Items take {pct}% of the case's volume. Not everything will fit.",
    'fill.overSq': "Items take {pct}% of the case's volume. Not everything will fit, even squeezed.",
    'fill.tight': '{pct}% of the volume: tight. Odd shapes may not all fit.',
    'fill.tightSq': '{pct}% of the volume: tight. Soft items may get squeezed.',
    'fill.ok': "Items take about {pct}% of the case's volume.",

    'stage.canvas': '3D view of the packed suitcase',
    'm.space': 'Space used',
    'm.items': 'Items packed',
    'm.weight': 'Weight',
    'm.free': 'Free space',
    'm.squeezed': '{n} soft items squeezed',
    'm.squeezedTitle': 'Soft items pressed flatter to make everything fit',
    'm.onTop': '{a}/{b} need-it-first items on top',
    'm.tried': '{n} layouts tried in {s} s',
    'view.xray': 'See-through walls',
    'view.top': 'Top view',
    'view.reset': 'Reset view',
    'empty.title': 'Your suitcase is empty',
    'empty.body': "Pick a trip or add items on the left, then press <b>Pack my suitcase</b>. You'll see every item turn and drop into place, step by step.",
    'loading.title': 'Finding the best layout…',
    'loading.note': 'Trying hundreds of arrangements of {n} items',
    'loading.progress': '{n} arrangements tried…',
    'gesture': 'Drag to rotate · scroll to zoom · right-drag to pan · click an item',

    'player.prev': 'Previous step',
    'player.next': 'Next step',
    'player.play': 'Play / pause',
    'player.scrub': 'Animation position',
    'player.speed': 'Speed',
    'player.step': 'Step {n} / {total}',
    'steps.title': 'Packing steps',
    'steps.copy': 'Copy',
    'steps.print': 'Print checklist',
    'badge.squeezed': 'squeezed {n}%',
    'badge.first': 'need it first',
    'badge.fragile': 'fragile',

    'banner.didntFit1': "1 item didn't fit.",
    'banner.didntFit': "{n} items didn't fit.",
    'banner.hint': 'Try a bigger case or fewer items.',
    'banner.hintNoSq': 'Try turning on squeezing, a bigger case or fewer items.',
    'banner.more': '…and {n} more',
    'banner.failed': 'Packing failed:',
    'reason.weight': 'would exceed the weight limit',
    'reason.tooBig': 'larger than the suitcase in every orientation',
    'reason.noSpace': 'no free space with enough support',
    'suitcase.custom': 'Custom suitcase',

    'toast.sharedLoaded': 'Loaded a shared packing list. Press "Pack my suitcase" to see it.',
    'toast.shareBad': "That share link couldn't be read.",
    'toast.loaded': 'Loaded "{name}"',
    'toast.deleted': 'Deleted "{name}"',
    'toast.deleteFail': "Couldn't delete: {msg}",
    'toast.saved': 'Saved "{name}"',
    'toast.saveFail': "Couldn't save: {msg}",
    'toast.needItemsSave': 'Add some items first, then save the trip.',
    'toast.needItemsShare': 'Add some items first, then share.',
    'toast.copiedLink': 'Link copied. Whoever opens it gets this suitcase and item list.',
    'toast.copiedCode': 'Trip code copied. Whoever opens it gets this suitcase and item list.',
    'toast.pressCopy': 'Press Ctrl+C (or ⌘C) to copy.',
    'toast.opened': 'Opened the shared trip. Press "Pack my suitcase" to see it.',
    'toast.badCode': "That doesn't look like a share link or trip code.",
    'toast.stepsCopied': 'Steps copied',
    'toast.copyFail': "Couldn't copy",
    'toast.installed': 'Installed. Open "Smart Packing Assistant" from your Start menu or desktop.',
    'toast.lang': 'Language: English',

    'print.title': 'Packing checklist',
    'print.alt': 'The packed suitcase',
    'print.space': 'space used',
    'print.items': 'items',
    'print.of': 'of {max} kg',
    'print.squeezed': 'squeezed',
    'print.didntFit': "Didn't fit:",

    'err.no3dTitle': '3D view unavailable',
    'err.no3dBody': 'Try a recent Chrome, Edge or Firefox.',
    'err.start': "Couldn't start",

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.langHint': 'Changes the whole app, including item names and packing steps. Remembered on this device.',
    'settings.close': 'Close',
    'settings.done': 'Done',

    'looks.box': 'Plain box',
    'looks.packing_cube': 'Packing cube',
    'looks.pouch': 'Zip pouch',
    'looks.tshirt': 'Folded top',
    'looks.jeans': 'Folded trousers',
    'looks.roll': 'Rolled clothing',
    'looks.sneakers': 'Shoes',
    'looks.book': 'Book',
    'looks.laptop': 'Laptop / tablet',
    'looks.bottle': 'Bottle',
    'looks.flask': 'Water bottle',
    'looks.gift': 'Gift box',
    'looks.snack_box': 'Carton',
    'looks.towel_roll': 'Rolled towel',
    'looks.camera': 'Camera',
  },

  'zh-Hant': {
    'app.title': '智慧打包助手',
    'app.tagline': '選好要帶的東西，我們幫你找出最省空間、最穩固的打包方式。',
    'top.install': '安裝 App',
    'top.settings': '設定',
    'mode.server': '在你的電腦上執行',
    'mode.browser': '在瀏覽器中執行',
    'mode.serverTitle': '由 Python 計算擺法；儲存的行程存放在 data/trips.json',
    'mode.browserTitle': '在這個瀏覽器中計算擺法；儲存的行程只存在這個瀏覽器裡',

    's1.title': '你的行李箱',
    's1.sizes': '行李箱尺寸',
    's1.length': '長',
    's1.width': '寬',
    's1.height': '高',
    's1.max': '上限',
    's1.hint': '請填內部尺寸，可依你的行李箱修改。',
    's1.colour': '行李箱顏色',
    'unit.cm': '公分',
    'unit.kg': '公斤',

    's2.title': '從行程範本開始',
    'trips.mine': '我的行程',
    'trips.save': '儲存目前清單',
    'trips.share': '分享',
    'trips.open': '開啟分享',
    'trips.copy': '複製',
    'trips.openBtn': '開啟',
    'trips.codeAria': '這個行程的分享代碼',
    'trips.codePh': '貼上分享連結或行程代碼',
    'trips.namePh': '取個名字，例如：三月東京',
    'trips.saveBtn': '儲存',
    'trips.cancel': '取消',
    'trips.hintServer': '儲存目前的選擇，下次可以直接使用。行程會存放在 data/trips.json。',
    'trips.hintBrowser': '儲存目前的選擇，下次可以直接使用。行程會存在這個瀏覽器裡。',
    'trips.count': '{n} 件物品',
    'trips.delete': '刪除「{name}」',

    's3.title': '你要帶什麼？',
    'search.ph': '搜尋 {n} 件物品：鞋子、筆電、毛巾…',
    'cat.all': '全部',
    'cat.selected': '已選',
    'list.yours': '自訂物品',
    'list.noMatch': '找不到「{q}」，可以在下方新增自訂物品。',
    'list.none': '還沒有選任何物品。',
    'item.remove': '減少一件{name}',
    'item.add': '增加一件{name}',
    'item.pinTitle': '優先取用：最後放入、放在最上層，方便拿取',
    'item.pinAria': '優先取用{name}',
    'tag.fragile': '易碎',
    'tag.upright': '需直立',
    'tag.soft': '可壓縮',
    'tag.softTitle': '最多可壓縮 {n}%',

    'custom.add': '＋ 新增自訂物品',
    'custom.name': '名稱',
    'custom.namePh': '例如：桌遊',
    'custom.weight': '重量（公斤）',
    'custom.looks': '外觀',
    'custom.fragile': '易碎（上面不放東西）',
    'custom.upright': '保持直立',
    'custom.submit': '新增物品',

    'sum.items': '{n} 件物品',
    'sum.item': '1 件物品',
    'sum.weight': '{kg} / {max} 公斤',
    'sum.weightNoMax': '{kg} 公斤',
    'sum.clear': '清除',
    'sum.squeeze': '空間不夠時壓縮軟質衣物',
    'sum.pack': '開始打包',
    'fill.empty': '先加入一些物品吧。',
    'fill.overKg': '超過 {max} 公斤上限，部分物品會放不進去。',
    'fill.over': '物品體積佔行李箱的 {pct}%，無法全部放入。',
    'fill.overSq': '物品體積佔行李箱的 {pct}%，即使壓縮也無法全部放入。',
    'fill.tight': '佔 {pct}% 的體積，有點擠，形狀特殊的物品可能放不下。',
    'fill.tightSq': '佔 {pct}% 的體積，有點擠，軟質衣物可能會被壓縮。',
    'fill.ok': '物品約佔行李箱 {pct}% 的體積。',

    'stage.canvas': '打包完成的行李箱 3D 畫面',
    'm.space': '空間使用率',
    'm.items': '已放入',
    'm.weight': '重量',
    'm.free': '剩餘空間',
    'm.squeezed': '{n} 件軟質衣物已壓縮',
    'm.squeezedTitle': '把軟質衣物壓扁一點，讓所有東西都放得下',
    'm.onTop': '{a}/{b} 件優先取用物品在最上層',
    'm.tried': '嘗試了 {n} 種擺法，耗時 {s} 秒',
    'view.xray': '透視箱壁',
    'view.top': '俯視圖',
    'view.reset': '重設視角',
    'empty.title': '行李箱還是空的',
    'empty.body': '在左邊選一個行程範本或加入物品，然後按<b>開始打包</b>。你會看到每件物品一步步轉向、放進行李箱。',
    'loading.title': '正在尋找最佳擺法…',
    'loading.note': '正在為 {n} 件物品嘗試數百種擺法',
    'loading.progress': '已嘗試 {n} 種擺法…',
    'gesture': '拖曳旋轉 · 滾輪縮放 · 右鍵拖曳平移 · 點選物品',

    'player.prev': '上一步',
    'player.next': '下一步',
    'player.play': '播放／暫停',
    'player.scrub': '動畫進度',
    'player.speed': '速度',
    'player.step': '第 {n} / {total} 步',
    'steps.title': '打包步驟',
    'steps.copy': '複製',
    'steps.print': '列印清單',
    'badge.squeezed': '已壓縮 {n}%',
    'badge.first': '優先取用',
    'badge.fragile': '易碎',

    'banner.didntFit1': '有 1 件物品放不下。',
    'banner.didntFit': '有 {n} 件物品放不下。',
    'banner.hint': '可以換大一點的行李箱，或減少物品。',
    'banner.hintNoSq': '可以開啟壓縮、換大一點的行李箱，或減少物品。',
    'banner.more': '…還有 {n} 件',
    'banner.failed': '打包失敗：',
    'reason.weight': '會超過重量上限',
    'reason.tooBig': '不論怎麼擺都比行李箱大',
    'reason.noSpace': '沒有能穩穩放置的空位',
    'suitcase.custom': '自訂行李箱',

    'toast.sharedLoaded': '已載入分享的打包清單，按「開始打包」即可查看。',
    'toast.shareBad': '無法讀取這個分享連結。',
    'toast.loaded': '已載入「{name}」',
    'toast.deleted': '已刪除「{name}」',
    'toast.deleteFail': '無法刪除：{msg}',
    'toast.saved': '已儲存「{name}」',
    'toast.saveFail': '無法儲存：{msg}',
    'toast.needItemsSave': '請先加入物品，再儲存行程。',
    'toast.needItemsShare': '請先加入物品，再分享。',
    'toast.copiedLink': '連結已複製。打開連結的人會看到同樣的行李箱和物品清單。',
    'toast.copiedCode': '行程代碼已複製。對方貼上後會看到同樣的行李箱和物品清單。',
    'toast.pressCopy': '請按 Ctrl+C（或 ⌘C）複製。',
    'toast.opened': '已開啟分享的行程，按「開始打包」即可查看。',
    'toast.badCode': '這看起來不是分享連結或行程代碼。',
    'toast.stepsCopied': '已複製步驟',
    'toast.copyFail': '無法複製',
    'toast.installed': '已安裝，可從開始選單或桌面開啟「智慧打包助手」。',
    'toast.lang': '語言：繁體中文',

    'print.title': '打包清單',
    'print.alt': '打包完成的行李箱',
    'print.space': '空間使用率',
    'print.items': '件物品',
    'print.of': '／{max} 公斤',
    'print.squeezed': '件已壓縮',
    'print.didntFit': '放不下：',

    'err.no3dTitle': '無法顯示 3D 畫面',
    'err.no3dBody': '請使用最新版的 Chrome、Edge 或 Firefox。',
    'err.start': '無法啟動',

    'settings.title': '設定',
    'settings.language': '語言',
    'settings.langHint': '會切換整個 App，包括物品名稱和打包步驟。此設定會記在這台裝置上。',
    'settings.close': '關閉',
    'settings.done': '完成',

    'looks.box': '普通盒子',
    'looks.packing_cube': '收納袋',
    'looks.pouch': '拉鍊包',
    'looks.tshirt': '摺好的上衣',
    'looks.jeans': '摺好的褲子',
    'looks.roll': '捲起的衣物',
    'looks.sneakers': '鞋子',
    'looks.book': '書',
    'looks.laptop': '筆電／平板',
    'looks.bottle': '瓶子',
    'looks.flask': '水壺',
    'looks.gift': '禮物盒',
    'looks.snack_box': '紙盒',
    'looks.towel_roll': '捲起的毛巾',
    'looks.camera': '相機',
  },
};

// Catalogue names. English comes from data/catalog.json itself.
const CATALOG = {
  'zh-Hant': {
    categories: {
      clothing: '衣物', shoes: '鞋子', toiletries: '盥洗用品', electronics: '電子產品',
      accessories: '配件', documents: '證件與書籍', 'travel gear': '旅行用品',
    },
    suitcases: {
      underseat: '座位下小包', carry_on: '登機箱', medium: '中型托運箱', large: '大型托運箱',
    },
    profiles: {
      weekend: '週末小旅行', business: '出差（3天）', beach: '海灘度假一週',
      city: '城市旅遊（5天）', two_weeks: '兩週假期', cubes: '收納袋打包法',
    },
    items: {
      tshirt: 'T恤（摺好）', tshirt_white: '白色T恤（摺好）', polo: 'Polo衫（摺好）',
      dress_shirt: '襯衫（摺好）', tank_top: '背心（摺好）', sweater: '針織毛衣（摺好）',
      hoodie: '連帽上衣（摺好）', light_jacket: '輕便外套（摺好）', puffer_jacket: '輕量羽絨外套（收納袋裝）',
      blazer: '西裝外套（摺好）', jeans: '牛仔褲（摺好）', chinos: '休閒長褲（摺好）',
      dress_pants: '西裝褲（摺好）', shorts: '短褲（摺好）', leggings: '內搭褲（捲起）',
      dress: '夏季洋裝（摺好）', skirt: '裙子（摺好）', pajamas: '睡衣組（摺好）',
      underwear: '內褲（捲起）', socks: '襪子（一雙，捲起）', swimsuit: '泳衣',
      swim_shorts: '泳褲（摺好）', scarf: '圍巾（捲起）', baseball_cap: '棒球帽',
      sun_hat: '可摺疊遮陽帽', gym_outfit: '運動服（捲成一組）',
      sneakers: '休閒鞋（一雙）', running_shoes: '跑鞋（一雙）', dress_shoes: '皮鞋（一雙）',
      ankle_boots: '短靴（一雙）', sandals: '涼鞋（一雙）', flip_flops: '夾腳拖（一雙）',
      slippers: '飯店拖鞋（一雙）',
      toiletry_bag: '盥洗包', makeup_bag: '化妝包', shampoo: '洗髮精（旅行裝）',
      conditioner: '潤髮乳（旅行裝）', body_lotion: '身體乳（壓瓶）', sunscreen: '防曬乳（條狀）',
      toothpaste: '牙膏', toothbrush: '牙刷（附盒）', deodorant: '止汗噴霧', perfume: '香水',
      face_cream: '面霜', razor: '刮鬍刀', hair_dryer: '旅行吹風機', straightener: '離子夾',
      first_aid: '急救包', medicine: '藥盒',
      laptop_13: '13 吋筆電', laptop_15: '15 吋筆電', tablet: '平板電腦', ereader: '電子書閱讀器',
      headphones: '耳罩式耳機（收納盒）', earbuds: '無線耳機', power_bank: '行動電源',
      charger: '筆電充電器', cable_pouch: '線材收納包', camera: '微單眼相機', camera_lens: '備用鏡頭',
      adapter: '旅行轉接頭', game_console: '掌上遊戲機',
      sunglasses: '太陽眼鏡（硬殼盒）', glasses: '閱讀眼鏡（眼鏡盒）', watch_box: '手錶盒',
      jewelry: '首飾袋', wallet: '旅行錢包', belt: '皮帶（捲起）', umbrella: '折疊傘',
      neck_pillow: '旅行頸枕', water_bottle: '水壺', tumbler: '咖啡隨行杯', eye_mask: '眼罩與耳塞',
      passport: '護照', documents: '旅行文件夾', book: '平裝書', hardcover: '精裝書', notebook: '筆記本',
      cube_s: '收納袋 S（已裝滿）', cube_m: '收納袋 M（已裝滿）', cube_l: '收納袋 L（已裝滿）',
      compression_cube: '壓縮收納袋（已裝滿）', laundry_bag: '洗衣袋（摺好）',
      towel: '超細纖維毛巾（捲起）', beach_towel: '海灘巾（捲起）', snacks: '零食盒',
      gift: '禮物盒', tripod: '旅行三腳架', yoga_mat: '旅行瑜伽墊（捲起）',
    },
  },
};

// Wording for the packing steps (built from the layout data, so every
// language gets the same instructions).
const STEP_TEXT = {
  en: {
    orientation: { flat: 'lying flat', side: 'on its side', end: 'standing on end', any: 'any way up' },
    depth: ['front', 'middle', 'back'],
    side: ['left', 'centre', 'right'],
    centre: 'centre',
    region: (d, s) => `${d}-${s}`,
    floor: 'on the bottom of the case',
    onTop: (list) => `on top of ${list.join(', ')}`,
    how: (o, r, sup) => `${o.charAt(0).toUpperCase()}${o.slice(1)} in the ${r} of the case, ${sup}.`,
    full: (name, o, r, sup) => `Place ${name} ${o} in the ${r} of the case, ${sup}.`,
    squeeze: (cm) => `Press it down to about ${cm} cm thick.`,
    top: "It's on top, so you can grab it without unpacking.",
    buried: '(Marked need-it-first, but it had to go lower down to fit everything.)',
    join: ' ',
  },
  'zh-Hant': {
    orientation: { flat: '平放', side: '側放', end: '直立放', any: '隨意擺放' },
    depth: ['前方', '中間', '後方'],
    side: ['左側', '中央', '右側'],
    centre: '正中央',
    region: (d, s) => `${d}${s}`,
    floor: '直接放在箱底',
    onTop: (list) => `疊在${list.join('、')}上面`,
    how: (o, r, sup) => `${o}在行李箱${r}，${sup}。`,
    full: (name, o, r, sup) => `把${name}${o}在行李箱${r}，${sup}。`,
    squeeze: (cm) => `壓扁到約 ${cm} 公分厚。`,
    top: '它在最上層，不用翻行李就能拿到。',
    buried: '（已標為優先取用，但為了全部放得下，只能放在較下層。）',
    join: '',
  },
};

const STORE_KEY = 'spa-lang';
const listeners = new Set();

function detect() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch { /* storage unavailable */ }
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language || '']) : [];
  return prefs.some((l) => /^zh\b/i.test(l || '')) ? 'zh-Hant' : 'en';
}

export let lang = typeof window === 'undefined' ? 'en' : detect();

export function setLang(code) {
  if (!STRINGS[code] || code === lang) return;
  lang = code;
  try { localStorage.setItem(STORE_KEY, code); } catch { /* per-device only */ }
  for (const fn of listeners) fn(code);
}

export function onLangChange(fn) { listeners.add(fn); }

/** Translate a key, filling {placeholders} from vars. Falls back to English. */
export function t(key, vars = {}) {
  const s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/** Localised catalogue name ("items", "categories", "suitcases", "profiles"). */
export function catalogName(kind, id, fallback) {
  const table = CATALOG[lang] && CATALOG[lang][kind];
  return (table && table[id]) || fallback;
}

/** Name of a packed item (layout step / unpacked entry), keeping "#2" suffixes. */
export function packedName(entry, catalogIds) {
  const [base, n] = String(entry.id).split('#');
  const cid = entry.catalog_id || base;
  if (!catalogIds.has(cid)) return entry.name;
  const name = catalogName('items', cid, null);
  if (!name) return entry.name;
  return n ? `${name} #${n}` : name;
}

/** Fill every [data-i18n*] element under root. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  document.documentElement.lang = lang;
  document.title = t('app.title');
}

const REASONS = {
  'would exceed the weight limit': 'reason.weight',
  'larger than the suitcase in every orientation': 'reason.tooBig',
  'no free space with enough support': 'reason.noSpace',
};
export function reasonText(reason) {
  return REASONS[reason] ? t(REASONS[reason]) : reason;
}

/**
 * Describe one packing step in the current language.
 * Returns { how, full }: `how` for the step list (item name shown separately),
 * `full` for copying and printing.
 */
export function describeStep(st, suitcase, nameOf) {
  const w = STEP_TEXT[lang] || STEP_TEXT.en;
  const dims = [...st.original_size].sort((a, b) => a - b);
  const h = st.size[2];
  const o = dims[0] === dims[2] ? w.orientation.any
    : h === dims[0] ? w.orientation.flat
      : h === dims[2] ? w.orientation.end : w.orientation.side;
  const cx = st.position[0] + st.size[0] / 2, cy = st.position[1] + st.size[1] / 2;
  const third = (v, total) => Math.min(2, Math.floor((3 * v) / total));
  const di = third(cy, suitcase.width), si = third(cx, suitcase.length);
  const region = di === 1 && si === 1 ? w.centre : w.region(w.depth[di], w.side[si]);
  const support = st.supported_by && st.supported_by.length ? w.onTop(st.supported_by.map(nameOf)) : w.floor;
  const extras = [];
  if (st.squeezed_pct) extras.push(w.squeeze(Math.round(Math.min(...st.original_size) * 10) / 10));
  if (st.priority) {
    const onTop = st.priority_on_top ?? !/lower down/.test(st.instruction || '');
    extras.push(onTop ? w.top : w.buried);
  }
  const tail = extras.length ? w.join + extras.join(w.join) : '';
  return { how: w.how(o, region, support) + tail, full: w.full(nameOf(st.id), o, region, support) + tail };
}

// For tests: every language must translate every key and catalogue entry.
export const _tables = { STRINGS, CATALOG, STEP_TEXT };
