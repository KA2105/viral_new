// src/store/useTaskFeed.ts
import { create } from 'zustand';

export type SocialPlatformId =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'nextsosyal'
  | 'tiktok'
  | 'x';

export type FeedCard = {
  id: string;                // kart id
  taskId: string;            // hangi görevden üretildi
  title: string;             // kart başlığı (o anki hali)
  description: string;       // kart açıklaması (o anki hali)
  platforms: SocialPlatformId[];
  createdAt: number;
  likes: number;
};

type TaskFeedState = {
  cards: FeedCard[];
  addCardFromTask: (params: {
    taskId: string;
    title: string;
    description: string;
    platforms: SocialPlatformId[];
  }) => void;
  likeCard: (id: string) => void;
};

const createId = () => Math.random().toString(36).slice(2);

export const useTaskFeed = create<TaskFeedState>((set) => ({
  cards: [],

  addCardFromTask: ({ taskId, title, description, platforms }) =>
    set((state) => ({
      cards: [
        {
          id: createId(),
          taskId,
          title,
          description,
          platforms,
          createdAt: Date.now(),
          likes: 0,
        },
        ...state.cards,
      ],
    })),

  likeCard: (id) =>
    set((state) => ({
      cards: state.cards.map((card) =>
        card.id === id ? { ...card, likes: card.likes + 1 } : card,
      ),
    })),
}));
