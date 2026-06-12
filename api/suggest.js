const Anthropic = require('@anthropic-ai/sdk');

// ── Emotion → intent signals ──────────────────────────────────────────────
// 感情テキストからキーワードと検索アングルを導出する
const EMOTION_PATTERNS = [
  {
    match: /疲れ|しんど|ぐったり|くたく|だる/,
    keywords: ['静か', '落ち着く', '定食', 'サウナ', '長居できる'],
    angle: '疲れを癒す・ゆっくりできる場所'
  },
  {
    match: /癒|ゆっくり|ほっこり|安らぎ/,
    keywords: ['静か', 'カフェ', 'サウナ', 'スパ', 'ぬくもり'],
    angle: '心と体を休める場所'
  },
  {
    match: /静か|落ち着|のんびり|まったり/,
    keywords: ['静か', '落ち着いた内装', 'カフェ', 'BGMが小さい', '一人でも居心地いい'],
    angle: '静かにゆっくり過ごせる場所'
  },
  {
    match: /孤独|ぼっち|一人|ひとり|物思い/,
    keywords: ['カウンター席', 'バー', 'ラーメン', '一人飯', '静か'],
    angle: '一人でも自然に過ごせる空間'
  },
  {
    match: /感傷|切ない|しんみり|寂しい/,
    keywords: ['隠れ家', 'ジャズバー', '夜景', '古民家カフェ', 'ウイスキー'],
    angle: '感傷に浸れる・余韻を楽しめる場所'
  },
  {
    match: /懐かし|昔|思い出|ノスタルジー/,
    keywords: ['老舗', '大衆食堂', '昭和レトロ', '銭湯', '下町'],
    angle: '懐かしさを感じられる場所'
  },
  {
    match: /高揚|元気|やる気|テンション|パワー/,
    keywords: ['居酒屋', '焼肉', '立ち飲み', 'にぎやか', '餃子'],
    angle: 'テンションが上がる・パワーをもらえる場所'
  },
  {
    match: /ワクワク|楽し|新し|体験|刺激/,
    keywords: ['体験型', '新発見', 'クラフトビール', 'ユニーク', '話題の'],
    angle: '新鮮な体験・ワクワクできる場所'
  },
  {
    match: /ロマン|デート|恋|特別な時間|誰かと/,
    keywords: ['個室', 'バー', 'ワイン', 'ディナー', 'キャンドル', 'デート'],
    angle: '特別感・ロマンチックな雰囲気の場所'
  },
  {
    match: /語|話し|友達|みんな|集まる/,
    keywords: ['個室', 'カウンター', '夜カフェ', 'バー', '会話しやすい'],
    angle: '会話が弾む・長居できる場所'
  },
  {
    match: /開放|自由|のびのび|外に出|空が見/,
    keywords: ['テラス', '屋上', '旅行', 'アウトドア', '景色'],
    angle: '開放感・自由を感じられる場所'
  },
  {
    match: /集中|仕事|作業|クリエ|考え/,
    keywords: ['カフェ', '静か', '長居できる', 'Wi-Fi', 'コワーキング'],
    angle: '集中できる・思考が捗る環境'
  },
  {
    match: /非日常|異世界|逃げ|リセット|別世界/,
    keywords: ['隠れ家', 'ホテルバー', '異国料理', '屋上', '非日常感'],
    angle: '日常から切り離された非日常感のある場所'
  },
  {
    match: /ご褒美|頑張|達成|最高|特別|贅沢/,
    keywords: ['寿司', '焼鳥', 'ビストロ', '少し贅沢', 'フレンチ', 'こだわり'],
    angle: '自分へのご褒美・特別な一軒'
  },
];

// ── Category → multi-axis search hints ───────────────────────────────────
// カテゴリごとに複数の検索軸を定義し、提案の幅を広げる
const CATEGORY_AXES = {
  'レストラン': [
    '雰囲気重視（照明・内装・BGM）',
    'コスパ・安くて満足できる店',
    '名店・老舗・職人こだわりの一軒',
    '深夜・遅い時間でも入れる店',
    '一人でも入りやすいカウンター席',
    'デート・記念日向け（個室・コース料理）',
    '隠れ家・路地裏・知る人ぞ知る名店',
  ],
  'カフェ': [
    '長居できる・作業向けカフェ',
    '雰囲気・内装が個性的なカフェ',
    '静かで落ち着ける空間',
    '夜カフェ・遅くまで開いている',
    'こだわりコーヒー・スペシャルティ',
  ],
  'バー': [
    'カウンター中心・一人でも入りやすい',
    'クラフトビール・ナチュラルワイン充実',
    'ホテルバー・高級感・特別な夜',
    '隠れ家・狭くて濃い雰囲気のバー',
    '夜景・ルーフトップバー',
  ],
  'サウナ': [
    '水風呂が深くてキンキンに冷たい',
    '外気浴スペースが広くととのいやすい',
    '駅近・アクセスがよい',
    '空いていて静かに集中できる',
    '銭湯併設・昭和の下町情緒',
    'プライベートサウナ・個室型',
  ],
  'イベント': [
    '今週末・近々開催のもの',
    '体験型・参加して楽しむ',
    'アート・展示・音楽ライブ',
    'フード・グルメ系マーケット',
    '夜開催・大人向けイベント',
  ],
  '旅行先': [
    '日帰りでいける温泉・秘境',
    '非日常感・異国情緒を味わえる街',
    '絶景・自然の中に身を置く',
    '一人旅・気軽に行ける近場',
    'グルメ目的の旅・食べ歩き',
  ],
  'スポーツ': [
    'スポーツ観戦（サッカー・野球・バスケ）',
    '体験型アクティビティ・初心者歓迎',
    'ランニング・サイクリングコース',
    'ボルダリング・クライミングジム',
    'アウトドアスポーツ・ハイキング・登山',
  ],
};

function detectEmotionSignals(emotion) {
  for (const p of EMOTION_PATTERNS) {
    if (p.match.test(emotion)) {
      return { keywords: p.keywords, angle: p.angle };
    }
  }
  return { keywords: ['雰囲気いい', 'おすすめ', '人気'], angle: '今の気分に合う場所' };
}

function getCategoryAxes(category) {
  if (!category) {
    return [
      '食事系（レストラン・カフェ・バー）',
      'サウナ・銭湯・リラクゼーション',
      '体験型イベント・アート',
      '旅行・お出かけスポット',
      'スポーツ・アウトドア',
    ];
  }
  const key = Object.keys(CATEGORY_AXES).find(k =>
    category.includes(k) || k.includes(category)
  );
  return key ? CATEGORY_AXES[key] : [
    '雰囲気重視',
    'コスパ重視',
    '特別感・非日常',
    '一人でも行ける',
  ];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { emotion, category, useWebSearch } = req.body || {};

  if (!emotion) {
    return res.status(400).json({ error: '感情・気分を入力してください' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数を確認してください。'
    });
  }

  const client = new Anthropic({ apiKey, timeout: 25_000 });

  const signals = detectEmotionSignals(emotion);
  const axes = getCategoryAxes(category);

  const systemPrompt = `あなたは「YOIN（余韻）」というアプリのAIアシスタントです。
ユーザーの感情・気分に合わせて、最適なスポットを5件提案してください。

## 感情シグナル（この情報を重視すること）
- 感情のアングル: ${signals.angle}
- 関連キーワード: ${signals.keywords.join('、')}

## 提案の多様性ルール（必ず守ること）
1. 同じジャンル・業態を2件以上出さない（例：バー2件はNG、居酒屋2件はNG）
2. 価格帯を分散させること（例：低価格帯・中価格帯・高価格帯を混在させる）
3. 雰囲気が重複しないこと（例：「静かな」ばかりはNG、「にぎやか」ばかりはNG）
4. 以下の複数の軸で候補を幅広く探し、バランスよく選ぶこと：
${axes.map((a, i) => `   ${i + 1}. ${a}`).join('\n')}

## 各提案に必ず含める評価軸
- atmosphere（雰囲気）: 空間・照明・音楽・客層などを具体的に（40文字程度）
- price_range: ¥記号で金額範囲（例: ¥800〜¥1,200）
- prestige（名店度）: 1〜5の整数（5が最高）
- emotion_match: 【必須・具体的に】今の感情「${signals.angle}」にどう合うかを理由込みで1〜2文
- description: おすすめポイントや特徴（60文字程度）

【必須】Web検索結果を参照した場合も含め、レスポンスは以下のJSONのみを返してください。説明文・前置き・マークダウン・コードブロックは絶対不要です:
{
  "suggestions": [
    {
      "name": "店名・場所名",
      "category": "カテゴリ（レストラン/カフェ/バー/サウナ/イベント/旅行先/スポーツ）",
      "atmosphere": "雰囲気の説明",
      "price_range": "¥1,000〜¥2,000",
      "prestige": 4,
      "emotion_match": "今の感情にどう合うかの説明",
      "description": "おすすめポイント"
    }
  ]
}`;

  const categoryText = category ? `\nカテゴリ: ${category}` : '';
  const userMessage = `感情・気分: ${emotion}${categoryText}
感情シグナル: ${signals.keywords.join('、')}（アングル: ${signals.angle}）

上記の感情・シグナルに合い、ジャンル・価格帯・雰囲気がそれぞれ異なる5件を提案してください。`;

  try {
    const useSearch = useWebSearch === true;
    const model = useSearch ? 'claude-3-7-sonnet-20250219' : 'claude-3-5-sonnet-20241022';

    const messageParams = {
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    };

    if (useSearch) {
      messageParams.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const response = await client.messages.create(messageParams);

    // web_search ツールが実際に発火したか記録
    const usedWebSearch = response.content.some(
      b => b.type === 'tool_use' && b.name === 'web_search'
    );

    // Extract all text blocks (ignore tool_use blocks)
    const textContent = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // Parse JSON — handle both raw JSON and markdown code blocks
    let jsonStr = null;
    const codeBlockMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonStr = jsonMatch[0];
    }

    if (!jsonStr) {
      return res.status(500).json({
        error: 'AIからの応答を解析できませんでした。もう一度お試しください。'
      });
    }

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch {
      return res.status(500).json({
        error: 'AIの応答形式が正しくありませんでした。もう一度お試しください。'
      });
    }

    if (!data.suggestions || !Array.isArray(data.suggestions)) {
      return res.status(500).json({ error: '提案データが見つかりませんでした' });
    }

    return res.status(200).json({
      suggestions: data.suggestions,
      meta: { used_web_search: usedWebSearch, model, signals }
    });

  } catch (error) {
    console.error('Anthropic API error:', error);

    const status = error.status || error.statusCode;

    if (status === 401) {
      return res.status(500).json({
        error: 'APIキーが無効です。Vercel環境変数の ANTHROPIC_API_KEY を確認してください。'
      });
    }
    if (status === 429) {
      return res.status(429).json({
        error: 'APIのレート制限に達しました。しばらく待ってから再試行してください。'
      });
    }
    if (status === 529 || status === 503) {
      return res.status(503).json({
        error: 'AIサービスが混雑しています。少し待ってから再試行してください。'
      });
    }
    if (status === 400) {
      return res.status(500).json({
        error: `リクエストエラー: ${error.message}`
      });
    }

    return res.status(500).json({
      error: `エラーが発生しました: ${error.message || 'Unknown error'}`
    });
  }
};
