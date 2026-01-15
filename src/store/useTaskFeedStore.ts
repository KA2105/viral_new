// src/store/useTaskFeedStore.ts
import { create } from 'zustand';

export type TaskPlatformId =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'nextsosyal'
  | 'tiktok'
  | 'x';

export type TaskCard = {
  id: string;
  title: string;
  description: string;
  platforms: TaskPlatformId[];
  createdAt: number;
  authorName: string;
  likes: number;
};

type TaskFeedState = {
  tasks: TaskCard[];
  addTask: (input: {
    title: string;
    description: string;
    platforms: TaskPlatformId[];
    authorName: string;
  }) => void;
};

const createId = () => Math.random().toString(36).slice(2);

export const useTaskFeedStore = create<TaskFeedState>((set) => ({
  // İstersen buraya 1–2 örnek kart koyup test edebilirsin
  tasks: [],
  addTask: ({ title, description, platforms, authorName }) =>
    set((state) => ({
      tasks: [
        {
          id: createId(),
          title,
          description,
          platforms,
          authorName,
          createdAt: Date.now(),
          likes: 0,
        },
        ...state.tasks, // yeni kart en üstte
      ],
    })),
}));
