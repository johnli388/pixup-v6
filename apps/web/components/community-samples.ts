import type { communityTypes } from '../../../packages/domain/community';

export const communitySampleTopics = [
  {
    id: 'beginners',
    name: 'Beginner questions',
    description: 'Your first card, your first binder, and all the questions in between.',
  },
  {
    id: 'sports',
    name: 'Sports cards',
    description: 'Favorite players, memorable games and the cards that tell their stories.',
  },
  {
    id: 'k-pop',
    name: 'K-pop',
    description: 'Photocard collections, comeback memories and creative binder layouts.',
  },
  {
    id: 'original-ip',
    name: 'Original IP and art',
    description: 'Meet original characters and explore the craft behind collectible art.',
  },
  {
    id: 'preservation',
    name: 'Storage and preservation',
    description: 'Compare everyday routines for organizing and caring for a collection.',
  },
  {
    id: 'gaming',
    name: 'Gaming worlds',
    description: 'Pixel adventures, favorite characters and collecting beyond the screen.',
  },
  {
    id: 'showcase',
    name: 'Collection showcases',
    description: 'Share a shelf, a completed page or one piece with a special meaning.',
  },
] as const;

type TopicId = (typeof communitySampleTopics)[number]['id'];
type SampleReply = { author: string; body: string };
type SamplePost = {
  id: string;
  type: (typeof communityTypes)[number];
  title: string;
  author: string;
  created_at: string;
  topics: TopicId[];
  body: string;
  likes: number;
  replies: SampleReply[];
};

// Fictional display fixtures, separate from member posts and moderation records.
export const communitySamplePosts: SamplePost[] = [
  {
    id: 'first-courtside-card',
    type: 'story',
    title: 'The card that brought me back to collecting',
    author: 'CourtSideAlex',
    created_at: '2026-10-30T15:30:00Z',
    topics: ['sports', 'showcase'],
    likes: 24,
    body: 'I stopped collecting after school, then found my old binder while helping my family move. Between the team checklists was a handwritten note about the first game we watched together.\n\nThat memory inspired a new page built around Court Culture. Above the Rim sits in the middle, with space around it for little notes about the games I watch with friends now. I am taking it slowly: one card, one memory, one page at a time.\n\nWhat made you start collecting again?',
    replies: [
      {
        author: 'BinderDays',
        body: 'My brother brought his childhood binder to dinner. We spent the whole evening remembering the trades behind each page.',
      },
      {
        author: 'PixelMoss',
        body: 'Leaving room for notes is such a lovely idea. I want to try that with my gaming collection.',
      },
    ],
  },
  {
    id: 'first-binder',
    type: 'question',
    title: 'How did you organize your very first binder?',
    author: 'NewChapter',
    created_at: '2026-10-30T13:00:00Z',
    topics: ['beginners', 'preservation'],
    likes: 12,
    body: 'My collection is still small: a few art cards, two sports cards and one Cloud Runner. I keep moving them between pages because I cannot decide whether to sort by series, color or the order I found them.\n\nI would love to hear what worked for you when you were starting out. Do you leave gaps for future additions, or enjoy the collection exactly as it is today?',
    replies: [
      {
        author: 'ArchiveNotes',
        body: 'I group by series and leave a spare page at the back. A simple list of what I own saves me from buying duplicates.',
      },
      {
        author: 'NeonPages',
        body: 'Color first for me! My binder is a little mood board, so I change the layout whenever I feel like it.',
      },
    ],
  },
  {
    id: 'midnight-page',
    type: 'story',
    title: 'A midnight-blue page for my After Hours collection',
    author: 'NeonPages',
    created_at: '2026-10-29T19:15:00Z',
    topics: ['k-pop', 'showcase'],
    likes: 31,
    body: 'This week I finished a page inspired by the fictional After Hours universe. LUNA sits beside NEON, with a handwritten track list on a separate divider. Violet, silver and midnight blue tie everything together.\n\nThe fun part was making the empty spaces feel intentional. I used removable paper placeholders instead of rushing to fill every pocket.\n\nDoes anyone else plan their binder like an album cover?',
    replies: [
      {
        author: 'OrbitSketchbook',
        body: 'I love a limited palette. I sometimes start with a single accent color and let that guide the whole page.',
      },
    ],
  },
  {
    id: 'collection-notebook',
    type: 'guide',
    title: 'My five-minute collection notebook',
    author: 'ArchiveNotes',
    created_at: '2026-10-29T16:00:00Z',
    topics: ['beginners', 'preservation'],
    likes: 19,
    body: 'I wanted a collection log that I would actually keep using. Here is the small routine that works for me.\n\n1. Write the card title, series and printed edition number.\n2. Note when it joined the collection and the story behind it.\n3. Add its binder page or storage location.\n4. Keep receipts and personal details in a separate private folder.\n5. Revisit the list before rearranging anything.\n\nI do not try to turn the notebook into a price tracker. It is simply a map of my collection and the memories attached to it.',
    replies: [
      {
        author: 'NewChapter',
        body: 'The location column is the part I was missing. Trying this before my next binder shuffle.',
      },
    ],
  },
  {
    id: 'orbital-sketch',
    type: 'discussion',
    title: 'From a tiny sketch to an entire character world',
    author: 'OrbitSketchbook',
    created_at: '2026-10-28T20:00:00Z',
    topics: ['original-ip'],
    likes: 17,
    body: 'Looking at Future Forms made me think about how much personality a simple shape can carry. A tilted ring, a small shadow or an unexpected color can suggest a whole world without any dialogue.\n\nIn my own sketchbook I try drawing the same character three ways: at rest, in motion and surprised. The silhouette has to tell the story before I add details.\n\nArtists and collectors: what makes an original character stay with you?',
    replies: [
      {
        author: 'SoftGeometry',
        body: 'For me it is a recognizable silhouette plus one surprising detail. Orbital feels curious even without a face.',
      },
    ],
  },
  {
    id: 'cloud-runner',
    type: 'story',
    title: 'Cloud Runner and the joy of a very small collection',
    author: 'PixelMoss',
    created_at: '2026-10-28T14:00:00Z',
    topics: ['gaming', 'beginners'],
    likes: 22,
    body: 'My entire Pixel Worlds collection fits on one page. Cloud Runner reminds me of rainy weekends spent exploring platform games with my sister, and Forest Spirit makes me want to draw my own little forest level.\n\nI used to think a collection needed to be complete to be worth sharing. Now I like having a handful of pieces I can talk about for ages.\n\nHere is a little encouragement for anyone starting with just one card: that is already a collection.',
    replies: [
      {
        author: 'CourtSideAlex',
        body: 'One piece with a great story is always worth sharing. This is exactly how I feel about my first Court Culture card.',
      },
    ],
  },
  {
    id: 'weekend-shelf',
    type: 'discussion',
    title: 'Weekend showcase: describe your favorite corner',
    author: 'SoftGeometry',
    created_at: '2026-10-27T18:30:00Z',
    topics: ['showcase', 'original-ip'],
    likes: 14,
    body: 'No elaborate display needed. Describe the little corner of your collection that makes you happiest.\n\nMine is a cyan-and-cream binder spread with Soft Geometry beside a sketch I made at a museum workshop. The sketch is wonky, the colors almost match, and that is why I love it.\n\nWhat would we find in your favorite corner?',
    replies: [
      {
        author: 'NeonPages',
        body: 'A violet divider, two After Hours cards and a handwritten note from the friend who got me into collecting.',
      },
    ],
  },
  {
    id: 'edition-numbers',
    type: 'question',
    title: 'Do you collect a favorite edition number?',
    author: 'BinderDays',
    created_at: '2026-10-27T11:00:00Z',
    topics: ['sports', 'beginners'],
    likes: 8,
    body: 'I noticed that I always pause when an edition number matches a favorite jersey number. I do not go hunting for them, but the coincidence adds a little story when it happens.\n\nDo numbers matter to your personal collection, or is the artwork always the deciding factor?',
    replies: [
      {
        author: 'CourtSideAlex',
        body: 'Artwork comes first for me, but a number connected to a memorable game is a nice bonus.',
      },
    ],
  },
];
