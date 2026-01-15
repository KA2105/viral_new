// src/types/post.ts

export type Post = {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  likes: number;
  username: string;
  linkedTaskId?: string;
};
