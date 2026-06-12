const Anthropic = require('@anthropic-ai/sdk');

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

  const client = new Anthropic({ apiKey });

  const systemPrompt = `あなたは「YOIN（余韻）」というアプリのAIアシスタントです。
ユーザーの感情・気分に合わせて、最適なスポットを5件提案してください。

以下の評価軸を特に重視してください：
- 店の雰囲気（atmosphere）：空間・照明・音楽・客層などを具体的に
- 価格帯（price_range）：¥記号で具体的な金額範囲
- 名店度（prestige）：1〜5の整数（5が最高）
- 感情との相性（emotion_match）：なぜこの感情・気分に合うかを一言で

必ず以下のJSONのみを返してください（マークダウン・コードブロック不要）:
{
  "suggestions": [
    {
      "name": "店名・場所名",
      "category": "カテゴリ（レストラン/カフェ/バー/サウナ/イベント/旅行先）",
      "atmosphere": "雰囲気の説明（40文字程度）",
      "price_range": "¥1,000〜¥2,000",
      "prestige": 4,
      "emotion_match": "感情との相性（30文字程度）",
      "description": "おすすめポイントや特徴（60文字程度）"
    }
  ]
}`;

  const categoryText = category ? `\nカテゴリ希望: ${category}` : '';
  const userMessage = `今の感情・気分: ${emotion}${categoryText}\n\nこの気分に合うスポットを5件提案してください。`;

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

    return res.status(200).json(data);

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
