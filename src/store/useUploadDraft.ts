// src/store/useUploadDraft.ts
import { create } from 'zustand';

type UploadDraftState = {
  preselectedTaskId: string | null;
  setPreselectedTaskId: (id: string | null) => void;
};

export const useUploadDraft = create<UploadDraftState>(set => ({
  preselectedTaskId: null,
  setPreselectedTaskId: (id) => set({ preselectedTaskId: id }),
}));
