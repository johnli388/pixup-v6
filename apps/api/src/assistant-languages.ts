import { locales, translate } from '../../../packages/domain/i18n';

const prompts = [
  'Find sports cards under $100',
  'Show sellers with K-pop cards',
  'Find buyers from my sales',
  'Show my orders',
  'How do I sell a card?',
  'What is RePool?',
];

// Normalize supported search vocabulary, never translate stored card titles or member text.
// This is a bounded local parser; complex prose still benefits from the optional AI planner.
export function assistantSearchText(source: string): string {
  const normalized = source.normalize('NFKC').trim().toLowerCase();
  for (const prompt of prompts)
    for (const locale of locales)
      if (translate(locale, prompt).normalize('NFKC').toLowerCase() === normalized)
        return prompt.toLowerCase();
  let text = normalized
    .replace(/^[¿¡\s]+/, '')
    .replace(/(\d+),(\d{1,2})(?=\s|\$|$)/g, '$1.$2')
    .replace(
      /(\d+(?:\.\d{1,2})?)\s*(?:美元|ドル|달러|\$)\s*(?:以下|未満|이하|미만)/g,
      ' under $1 ',
    );
  const western: [string, string][] = [
    ['quién compró|quien compro|qui a acheté', 'buyers'],
    ["cómo|como|comment|qu’est-ce que|qu'est-ce que|qué es|que es", 'how'],
    ["cartes d’art|cartes d'art", 'art cards'],
    ["moins de|menos de|por debajo de|hasta|jusqu’à|jusqu'à", 'under'],
    ['compradores?|clientes?|acheteurs?', 'buyers'],
    ['vendedores?|vendeurs?', 'sellers'],
    ['pedidos?|commandes?|achats|compras', 'orders'],
    ['ventas?|ventes?', 'sales'],
    ['deportivas?|deportivos?|deportes?|sportives?|sports?', 'sports'],
    ['videojuegos?|jeux vidéo|jeux|juegos?', 'gaming'],
    ['artes?', 'art'],
    ['tarjetas?|cartas?|cartes?|photocartes', 'cards'],
    ['busca|buscar|encuentra|encontrar|trouver|chercher|rechercher', 'find'],
    ['muestra|mostrar|afficher|montre|montrez', 'show'],
    ['vender|vendo|vendre', 'sell'],
    ['publicar|publico|publier|publie', 'publish'],
    ['colecciones?|collections?', 'collection'],
    ['créditos?|crédits?', 'credits'],
    ['dólares?|dollars?', 'dollars'],
    ['comunidad|communauté', 'community'],
    ['canales?|canaux', 'channels'],
    ['remboursements?|reembolsos?', 'refund'],
    ['ayuda|aide', 'help'],
    ['más baratos|moins chers|moins cher', 'cheaper'],
    ['mis|mi|mes|mon|ma', 'my'],
    [
      'les|des|de|du|la|le|las|los|un|une|una|unos|unas|por|pour|con|avec|à|a|en|d|s’il vous plaît|por favor',
      '',
    ],
  ];
  for (const [words, replacement] of western)
    text = text.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'gu'),
      ` ${replacement} `,
    );
  const eastern: [string, string][] = [
    ['如何|怎么|什么是|とは|には|どうやって|어떻게|무엇인가요|이란', 'how'],
    ['买家|買い手|購入者|구매자', 'buyers'],
    ['卖家|売り手|出品者|판매자', 'sellers'],
    ['订单|注文|주문', 'orders'],
    ['销售记录|販売履歴|판매 기록', 'sales'],
    ['体育|运动|スポーツ|스포츠', 'sports'],
    ['艺术|美术|アート|아트', 'art'],
    ['韩流|韩国流行|ケーポップ|케이팝', 'k-pop'],
    ['游戏|ゲーム|게임', 'gaming'],
    ['卡牌|卡片|カード|카드', 'cards'],
    ['积分|クレジット|크레딧', 'credits'],
    ['社区|コミュニティ|커뮤니티', 'community'],
    ['渠道|チャネル|채널', 'channels'],
    ['退款|返金|환불', 'refund'],
    ['发布|公開|공개', 'publish'],
    ['系列|コレクション|컬렉션', 'collection'],
    ['出售|売る|판매', 'sell'],
    ['我的|自分の|내', 'my'],
    ['查找|寻找|搜索|探して|探す|검색|찾아줘|찾기|找', 'find'],
    ['显示|表示|보여줘', 'show'],
    ['帮助|ヘルプ|도움말', 'help'],
    ['(?<!\\S)(?:的|の|を|で|は|が|에서|해주세요|주세요)(?!\\S)', ''],
  ];
  for (const [words, replacement] of eastern)
    text = text.replace(new RegExp(words, 'gu'), ` ${replacement} `);
  text = text.replace(/\s+/g, ' ').trim();
  if (/\bhow\b/.test(text) && !text.startsWith('how')) text = 'how ' + text.replace(/\bhow\b/, '');
  return text;
}
