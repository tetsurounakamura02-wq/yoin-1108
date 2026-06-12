const Anthropic = require('@anthropic-ai/sdk');

// live / sports は必ず web_search を使う
const WEB_SEARCH_MODES = new Set(['live', 'sports']);

// JST の今日の日付文字列を返す（例: "2026/06/12(金)"）
function getTodayJST() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
  return `${y}/${m}/${d}(${dow})`;
}

function formatBudget(budget) {
  return { '〜3000': '〜¥3,000', '3000-8000': '¥3,000〜¥8,000',
           '8000-20000': '¥8,000〜¥20,000', '20000+': '¥20,000以上' }[budget] || null;
}

// URL に関するルール（全モード共通）
const URL_RULE = `【URLルール（必須）】
- Web検索で実際に見つけたURLのみ使う
- 存在確認できないURLは必ず null にする（推測URLは絶対に使わない）
- 検索URLの例: ぴあ→ https://lp.p.pia.jp/s/search/search.html?kw=<公演名>
               イープラス→ https://eplus.jp/sf/search?keyword=<公演名>`;

// spots[] の各要素スキーマ
const SPOT_SCHEMA = `{"name":"名前","address":"住所または最寄り駅","price":"価格帯","tags":["タグ"],"url":null,"reason":"合う理由（1〜2文）"}`;
// experiences[] の各要素スキーマ
const EXP_SCHEMA  = `{"name":"体験名","area":"エリア","duration":"所要時間","price":"費用目安","tags":["タグ"],"url":null,"reason":"旅のテーマに合う理由"}`;

function buildSystemPrompt(mode, { tags, area, freeText, exclude, count, budget, dayRange }) {
  const today      = getTodayJST();
  const budgetText = formatBudget(budget);
  const tagLine    = tags.length ? tags.join('、') : '指定なし';
  const excClause  = exclude.length ? `\n【絶対除外】次の名前は絶対に提案しないこと: ${exclude.join('、')}` : '';
  const budClause  = budgetText ? `\n予算: ${budgetText}` : '';
  const freeClause = freeText   ? `\n追加条件: ${freeText}` : '';

  if (mode === 'tonight') {
    return `あなたはYOINのAIアシスタントです。
エリア: ${area} / 今日: ${today} / 提案数: ${count}件${budClause}${freeClause}
気分・タグ: ${tagLine}${excClause}

今夜行けるスポットを${count}件、ジャンル・価格帯・雰囲気が被らないよう提案してください。
同ジャンル2件以上NG。グループは2〜3個で分類してください。
${URL_RULE}

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}・今夜の過ごし方","subtitle":"今の気分に合う場所","groups":[{"label":"グループ名","spots":[${SPOT_SCHEMA}]}]}`;
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
    const period  = dayRange === 'week' ? `${today}から7日間` : `今夜(${today})`;
    const dateTag = dayRange === 'week' ? '\n・tagsに開催日（例:"6/15(日)"）を必ず含めること' : '';
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
    return `あなたはYOINのAIアシスタントです。
エリア: ${area} / 提案数: ${count}件${budClause}${freeClause}
テーマ・タグ: ${tagLine}${excClause}

${area}エリアの旅行体験・スポットを${count}件提案してください。同ジャンル2件以上NG。
${URL_RULE}

JSONのみ返してください（説明文・マークダウン不要）:
{"title":"${area}への旅","subtitle":"旅のテーマ","experiences":[${EXP_SCHEMA}]}`;
  }

  return null;
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
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数を確認してください。'
    });
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
    return res.status(400).json({ error: `不明なモード: ${mode}` });
  }

  const useWebSearch = WEB_SEARCH_MODES.has(mode);
  const client = new Anthropic({ apiKey, timeout: 25_000 });

  const userMessage = useWebSearch
    ? `${area}の${mode === 'sports' ? 'スポーツ試合' : 'ライブ・公演'}情報を今すぐ検索してください。`
    : '上記の条件で提案してください。';

  try {
    const messageParams = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    };

    if (useWebSearch) {
      messageParams.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

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
      return res.status(500).json({ error: 'AIからの応答を解析できませんでした。もう一度お試しください。' });
    }

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({ error: 'AIの応答形式が正しくありませんでした。もう一度お試しください。' });
    }

    return res.status(200).json({ ...data, meta: { used_web_search: usedWebSearch, mode } });

  } catch (error) {
    console.error('Anthropic API error:', error);
    const status = error.status || error.statusCode;
    if (status === 401) return res.status(500).json({ error: 'APIキーが無効です。Vercel環境変数の ANTHROPIC_API_KEY を確認してください。' });
    if (status === 429) return res.status(429).json({ error: 'APIのレート制限に達しました。しばらく待ってから再試行してください。' });
    if (status === 529 || status === 503) return res.status(503).json({ error: 'AIサービスが混雑しています。少し待ってから再試行してください。' });
    if (status === 400) return res.status(500).json({ error: `リクエストエラー: ${error.message}` });
    return res.status(500).json({ error: `エラーが発生しました: ${error.message || 'Unknown error'}` });
  }
};
