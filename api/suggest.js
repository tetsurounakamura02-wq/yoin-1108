const Anthropic = require('@anthropic-ai/sdk');

const WEB_SEARCH_MODES = new Set(['live', 'sports']);
const API_TIMEOUT_MS   = 25_000;

function getTodayJST() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y   = jst.getUTCFullYear();
  const m   = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(jst.getUTCDate()).padStart(2, '0');
  const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  return `${y}/${m}/${d}(${dow})`;
}

function formatBudget(budget) {
  return { '〜3000': '〜¥3,000', '3000-8000': '¥3,000〜¥8,000',
           '8000-20000': '¥8,000〜¥20,000', '20000+': '¥20,000以上' }[budget] || null;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function nonce()   { return Math.random().toString(36).slice(2, 8); }

// 毎リクエストで視点を変えることで同じ候補の繰り返しを防ぐ
const TONIGHT_ANGLES = [
  { label: '穴場・隠れ家',   text: '有名すぎない地元民が通う隠れ家を優先。有名チェーン・観光地は避けること。' },
  { label: '新店・話題店',   text: '最近オープンした店や今月話題の新規店を優先。老舗より新しい発見を。' },
  { label: '老舗・職人技',   text: '長年愛されてきた老舗・名匠の店を優先。歴史と職人技を感じられる場所を。' },
  { label: '地元の常連',     text: '観光客より地元の常連が多い、地域に根差した店を優先。地元誌に載るような場所を。' },
  { label: '個性派・非日常', text: '他にはない独自コンセプトの店を優先。初めてなのに「ここしかない」と感じる場所を。' },
];

const TRAVEL_ANGLES = [
  '定番観光地より一歩深い、地元のリアルな体験を重視してください。',
  '自然・アウトドア・非日常体験を軸に選んでください。',
  '食文化・地酒・郷土料理など「食」の体験を重視してください。',
  '伝統工芸・アート・歴史的文化財に触れる体験を重視してください。',
  '温泉・湯治・リトリートなど心身を整える体験を重視してください。',
];

const URL_RULE = `【URLルール（必須）】
- Web検索で実際に見つけたURLのみ使う
- 存在確認できないURLは必ず null にする（推測URLは絶対に使わない）
- 検索URLの例: ぴあ→ https://lp.p.pia.jp/s/search/search.html?kw=<公演名>
               イープラス→ https://eplus.jp/sf/search?keyword=<公演名>`;

const SPOT_SCHEMA = `{"name":"名前","address":"住所または最寄り駅","price":"価格帯","tags":["タグ"],"url":null,"reason":"合う理由（1〜2文）"}`;
const EXP_SCHEMA  = `{"name":"体験名","area":"エリア","duration":"所要時間","price":"費用目安","tags":["タグ"],"url":null,"reason":"旅のテーマに合う理由"}`;

const EMOTION_TO_GENRES = {
  疲れた:   ['静かなバー', '一人でつまめる居酒屋', 'カウンター割烹'],
  癒やし:   ['和食', 'カフェバー', '日本酒バー'],
  ひとり:   ['カウンター席のバー', 'ラーメン', '立ち飲み'],
  楽しい:   ['クラフトビール', '焼き鳥', 'ダイニングバー'],
  飲みたい: ['角打ち', 'ビアバー', 'ハイボール居酒屋'],
  サウナ:   ['サウナ後のビール', '定食', 'ラーメン'],
  食べたい: ['和食', '肉料理', '麺類'],
  甘いもの: ['スイーツバー', 'カフェ', 'デザート専門'],
  記念日:   ['個室和食', 'ワインバー', '鉄板焼き'],
  おしゃれ: ['ルーフトップバー', 'ワインバー', 'クラフトカクテル'],
};

function detectGenresFromTags(tags) {
  const genres = new Set();
  for (const tag of tags) {
    const matches = EMOTION_TO_GENRES[tag];
    if (matches) matches.forEach(g => genres.add(g));
  }
  return [...genres].slice(0, 6);
}

function buildSystemPrompt(mode, { tags, area, freeText, exclude, count, budget, dayRange }) {
  const today      = getTodayJST();
  const budgetText = formatBudget(budget);
  const tagLine    = tags.length ? tags.join('、') : '指定なし';
  const excClause  = exclude.length ? `\n【絶対除外】次の名前は絶対に提案しないこと: ${exclude.join('、')}` : '';
  const budClause  = budgetText ? `\n予算: ${budgetText}` : '';
  const freeClause = freeText   ? `\n追加条件: ${freeText}` : '';

  if (mode === 'tonight') {
    const angle      = pick(TONIGHT_ANGLES);
    const genreHints = detectGenresFromTags(tags);
    const genreLine  = genreHints.length ? `\n候補ジャンル（参考）: ${genreHints.join('、')}` : '';
    const seed       = nonce();
    return `あなたはYOINのAIアシスタントです。（探索ID: ${seed}）
エリア: ${area} / 今日: ${today} / 提案数: ${count}件${budClause}${freeClause}
気分・タグ: ${tagLine}${genreLine}${excClause}
今回の視点: 【${angle.label}】${angle.text}

今夜行けるスポットを${count}件提案してください。以下を厳守すること:
【多様性ルール（必須）】
- 同じジャンルを2件以上出さない
- 同じ価格帯を2件以上続けない
- 提案を必ず3方向に分けること:
    ① 雰囲気・空間重視（落ち着ける・静かな・こじんまり）
    ② 名店感・こだわり重視（人気店・老舗・クオリティ）
    ③ コスパ・気軽さ重視（安く行ける・ふらっと入れる）
- 「今回の視点」を全スポットに反映すること
- グループ名は上記①②③のラベルをそのまま使うこと
URLはすべて null にすること（推測URL禁止）

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}・今夜の過ごし方","subtitle":"${angle.label}で探す","groups":[{"label":"グループ名","spots":[${SPOT_SCHEMA}]}]}`;
  }

  if (mode === 'live') {
    const period  = dayRange === 'week' ? `${today}から7日間` : `今夜(${today})`;
    const dateTag = dayRange === 'week' ? '\n・tagsに開催日（例:"6/15(日)"）を必ず含めること' : '';
    return `あなたはYOINのAIアシスタントです。
エリア: ${area} / 期間: ${period} / 提案数: ${count}件${budClause}${freeClause}
ジャンル・タグ: ${tagLine}${excClause}

Web検索で${area}エリアの${period}に開催されるライブ・コンサート・公演を検索し、実在するイベントのみ提案してください。
検索で確認できたものだけ出す。見つからなければ件数を減らしてよい。${dateTag}
${URL_RULE}

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}・ライブ情報","subtitle":"${period}","groups":[{"label":"ジャンル名","spots":[${SPOT_SCHEMA}]}]}`;
  }

  if (mode === 'sports') {
    const period       = dayRange === 'week' ? `${today}から7日間` : `今夜(${today})`;
    const dateTag      = dayRange === 'week' ? '\n・tagsに開催日（例:"6/15(日)"）を必ず含めること' : '';
    const sportPriority = tags.length ? `「${tagLine}」を優先。` : '';
    return `あなたはYOINのAIアシスタントです。
エリア: ${area}周辺（関東全域対応） / 期間: ${period} / 提案数: ${count}件${budClause}${freeClause}
スポーツ・タグ: ${tagLine}${excClause}

Web検索で関東エリア（${area}周辺含む）の${period}に開催される試合を検索し、実在するもののみ提案してください。
対象: プロ野球・Jリーグ・Bリーグ・バレーボール・東京六大学野球・大学サッカー
${sportPriority}検索で確認できたものだけ出す。見つからなければ件数を減らしてよい。${dateTag}
${URL_RULE}

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}周辺・スポーツ観戦","subtitle":"${period}","groups":[{"label":"スポーツ種別","spots":[${SPOT_SCHEMA}]}]}`;
  }

  if (mode === 'travel') {
    const angle = pick(TRAVEL_ANGLES);
    const seed  = nonce();
    return `あなたはYOINのAIアシスタントです。（探索ID: ${seed}）
エリア: ${area} / 提案数: ${count}件${budClause}${freeClause}
テーマ・タグ: ${tagLine}${excClause}
今回の視点: ${angle}

${area}エリアの旅行体験・スポットを${count}件提案してください。同ジャンル2件以上NG。
URLはすべて null にすること（推測URL禁止）

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}への旅","subtitle":"旅のテーマ","experiences":[${EXP_SCHEMA}]}`;
  }

  return null;
}

function errorResponse(res, message, mode) {
  return res.status(200).json({
    title: 'しばらく待ってから再度お試しください',
    subtitle: message,
    groups: [],
    meta: { error: true, error_message: message, mode },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    mode     = 'tonight',
    tags     = [],
    area     = '東京',
    freeText = '',
    exclude  = [],
    count    = 5,
    budget   = null,
    dayRange = 'tonight',
  } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse(res, 'ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数を確認してください。', mode);
  }

  const systemPrompt = buildSystemPrompt(mode, {
    tags:     Array.isArray(tags)    ? tags    : [],
    area:     String(area  || '東京'),
    freeText: String(freeText || ''),
    exclude:  Array.isArray(exclude) ? exclude : [],
    count:    Math.min(8, Math.max(1, Number(count) || 5)),
    budget:   budget || null,
    dayRange: dayRange || 'tonight',
  });

  if (!systemPrompt) {
    return errorResponse(res, `不明なモード: ${mode}`, mode);
  }

  const useWebSearch = WEB_SEARCH_MODES.has(mode);
  const userMessage  = useWebSearch
    ? `${area}の${mode === 'sports' ? 'スポーツ試合' : 'ライブ・公演'}情報を今すぐ検索してください。`
    : '上記の条件で提案してください。';

  try {
    const messageParams = {
      model:      'claude-sonnet-4-6',
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    };

    if (useWebSearch) {
      messageParams.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const client   = new Anthropic({ apiKey, timeout: API_TIMEOUT_MS });
    const response = await client.messages.create(messageParams);

    const usedWebSearch = response.content.some(
      b => b.type === 'tool_use' && b.name === 'web_search'
    );

    const textContent = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    let jsonStr = null;
    const codeBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
    }

    if (!jsonStr) {
      return errorResponse(res, 'AIからの応答を解析できませんでした。もう一度お試しください。', mode);
    }

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return errorResponse(res, 'AIの応答形式が正しくありませんでした。もう一度お試しください。', mode);
    }

    return res.status(200).json({
      ...data,
      meta: { used_web_search: usedWebSearch, mode },
    });

  } catch (error) {
    console.error('Anthropic API error:', error);
    const status  = error.status || error.statusCode;
    const message =
      status === 401 ? 'APIキーが無効です。環境変数 ANTHROPIC_API_KEY を確認してください。' :
      status === 429 ? 'APIのレート制限に達しました。少し待ってから再試行してください。' :
      (status === 529 || status === 503) ? 'AIサービスが混雑しています。少し待ってから再試行してください。' :
      `エラーが発生しました: ${error.message || 'Unknown error'}`;
    return errorResponse(res, message, mode);
  }
};
